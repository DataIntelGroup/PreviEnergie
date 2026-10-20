-- V1 : partage de compteur (BF-15), factures postpayées (BF-14),
-- bilan hebdomadaire (BF-21).

-- ================================================================ partage
-- Le propriétaire invite par email. L'invité voit l'invitation une fois
-- connecté avec cette adresse, l'accepte, puis suit le compteur :
-- « lecteur » voit tout, « contributeur » ajoute aussi relevés et recharges.
create table public.meter_shares (
  id           uuid primary key default gen_random_uuid(),
  meter_id     uuid not null references public.meters (id) on delete cascade,
  owner_id     uuid not null references public.profiles (id) on delete cascade,
  owner_name   text not null default '',
  email        text not null check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  member_id    uuid references public.profiles (id) on delete cascade,
  role         text not null default 'lecteur' check (role in ('lecteur', 'contributeur')),
  alerts       boolean not null default true,
  status       text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  unique (meter_id, email)
);

create index meter_shares_member_idx on public.meter_shares (member_id) where status = 'accepted';
create index meter_shares_email_idx on public.meter_shares (lower(email)) where status = 'pending';

create function public.my_email() returns text
language sql stable security definer set search_path = '' as $$
  select lower(email) from public.profiles where id = auth.uid()
$$;

-- Voir un compteur : le sien, ou un compteur partagé et accepté.
create function public.can_view_meter(p_meter uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.meters where id = p_meter and user_id = auth.uid())
      or exists (select 1 from public.meter_shares
                 where meter_id = p_meter and member_id = auth.uid() and status = 'accepted')
$$;

-- Saisir sur un compteur : le sien, ou partagé en contributeur.
create function public.can_edit_meter(p_meter uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.meters where id = p_meter and user_id = auth.uid())
      or exists (select 1 from public.meter_shares
                 where meter_id = p_meter and member_id = auth.uid() and status = 'accepted' and role = 'contributeur')
$$;

alter table public.meter_shares enable row level security;
grant select on public.meter_shares to authenticated;
create policy shares_read on public.meter_shares for select to authenticated
  using (owner_id = auth.uid() or member_id = auth.uid()
         or (status = 'pending' and lower(email) = public.my_email())
         or public.is_staff());
-- Écritures : uniquement par les fonctions ci-dessous.

create function public.share_meter(p_meter uuid, p_email text, p_role text default 'lecteur', p_alerts boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_owner public.profiles;
  v_row public.meter_shares;
begin
  if auth.uid() is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;
  if not exists (select 1 from public.meters where id = p_meter and user_id = auth.uid()) then
    raise exception 'Seul le propriétaire du compteur peut le partager' using errcode = '42501';
  end if;
  select * into v_owner from public.profiles where id = auth.uid();
  if v_email = lower(coalesce(v_owner.email, '')) then
    raise exception 'Tu ne peux pas te partager ton propre compteur' using errcode = '22023';
  end if;
  if p_role not in ('lecteur', 'contributeur') then
    raise exception 'Rôle inconnu' using errcode = '22023';
  end if;
  if (select count(*) from public.meter_shares where meter_id = p_meter) >= 5
     and not exists (select 1 from public.meter_shares where meter_id = p_meter and email = v_email) then
    raise exception 'Un compteur se partage avec 5 personnes au plus' using errcode = 'P0001';
  end if;
  insert into public.meter_shares (meter_id, owner_id, owner_name, email, role, alerts)
  values (p_meter, auth.uid(), btrim(coalesce(v_owner.first_name, '') || ' ' || coalesce(v_owner.last_name, '')), v_email, p_role, coalesce(p_alerts, true))
  on conflict (meter_id, email) do update set role = excluded.role, alerts = excluded.alerts
  returning * into v_row;
  return to_jsonb(v_row);
end $$;

create function public.accept_share(p_share uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.meter_shares
  set member_id = auth.uid(), status = 'accepted', accepted_at = now()
  where id = p_share and status = 'pending' and lower(email) = public.my_email()
    and owner_id <> auth.uid();
  if not found then
    raise exception 'Invitation introuvable' using errcode = 'P0002';
  end if;
end $$;

-- Propriétaire : rôle. Membre : recevoir ou non les alertes.
create function public.update_share(p_share uuid, p_role text default null, p_alerts boolean default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v public.meter_shares;
begin
  select * into v from public.meter_shares where id = p_share for update;
  if not found then
    raise exception 'Partage introuvable' using errcode = 'P0002';
  end if;
  if p_role is not null then
    if v.owner_id is distinct from auth.uid() then
      raise exception 'Seul le propriétaire change le rôle' using errcode = '42501';
    end if;
    if p_role not in ('lecteur', 'contributeur') then
      raise exception 'Rôle inconnu' using errcode = '22023';
    end if;
    update public.meter_shares set role = p_role where id = p_share;
  end if;
  if p_alerts is not null then
    if v.owner_id is distinct from auth.uid() and v.member_id is distinct from auth.uid() then
      raise exception 'Action non autorisée' using errcode = '42501';
    end if;
    update public.meter_shares set alerts = p_alerts where id = p_share;
  end if;
end $$;

-- Retirer : le propriétaire, le membre (quitter) ou l'invité (refuser).
create function public.remove_share(p_share uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.meter_shares
  where id = p_share
    and (owner_id = auth.uid() or member_id = auth.uid()
         or (status = 'pending' and lower(email) = public.my_email()));
  if not found then
    raise exception 'Partage introuvable' using errcode = 'P0002';
  end if;
end $$;

-- Les règles de lecture passent du « c'est moi qui l'ai saisi » au
-- « je peux voir ce compteur » : un membre voit les relevés du propriétaire.
drop policy meters_read on public.meters;
create policy meters_read on public.meters for select to authenticated
  using (user_id = auth.uid() or public.can_view_meter(id) or public.is_staff());

drop policy readings_read on public.readings;
drop policy readings_insert on public.readings;
drop policy readings_delete on public.readings;
create policy readings_read on public.readings for select to authenticated
  using (public.can_view_meter(meter_id) or public.is_staff());
create policy readings_insert on public.readings for insert to authenticated
  with check (user_id = auth.uid() and public.can_edit_meter(meter_id) and public.is_active_user());
create policy readings_delete on public.readings for delete to authenticated
  using (user_id = auth.uid() or public.owns_meter(meter_id));

drop policy recharges_read on public.recharges;
drop policy recharges_insert on public.recharges;
drop policy recharges_delete on public.recharges;
create policy recharges_read on public.recharges for select to authenticated
  using (public.can_view_meter(meter_id) or public.is_staff());
create policy recharges_insert on public.recharges for insert to authenticated
  with check (user_id = auth.uid() and public.can_edit_meter(meter_id) and public.is_active_user());
create policy recharges_delete on public.recharges for delete to authenticated
  using (user_id = auth.uid() or public.owns_meter(meter_id));

drop policy forecasts_read on public.forecasts;
create policy forecasts_read on public.forecasts for select to authenticated
  using (public.can_view_meter(meter_id) or public.is_staff());

drop policy feedback_read on public.cutoff_feedback;
drop policy feedback_insert on public.cutoff_feedback;
create policy feedback_read on public.cutoff_feedback for select to authenticated
  using (public.can_view_meter(meter_id) or public.is_staff());
create policy feedback_insert on public.cutoff_feedback for insert to authenticated
  with check (user_id = auth.uid() and public.can_edit_meter(meter_id));

-- Une alerte part à chaque destinataire (propriétaire et membres) : le
-- destinataire entre dans la clé d'unicité.
alter table public.alerts drop constraint alerts_meter_id_type_cycle_key_channel_key;
alter table public.alerts add constraint alerts_unique_send unique (meter_id, user_id, type, cycle_key, channel);

-- ================================================================ factures postpayées (BF-14)
-- La facture CIE basse tension (bimestrielle) donne la période, l'index de
-- fin, la consommation et le total. On en tire une part fixe (prime fixe et
-- taxes : électrification rurale, ordures ménagères, RTI, timbre) et un prix
-- réel du kWh, TVA comprise : l'estimation n'invente aucun tarif.
create table public.bills (
  id            uuid primary key default gen_random_uuid(),
  meter_id      uuid not null references public.meters (id) on delete cascade,
  user_id       uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  period_start  date not null,
  period_end    date not null,
  index_start   numeric(12, 2) check (index_start is null or index_start >= 0),
  index_end     numeric(12, 2) check (index_end is null or index_end >= 0),
  kwh           numeric(12, 2) not null check (kwh > 0),
  amount_fcfa   integer not null check (amount_fcfa > 0),
  -- Prime fixe TTC + autres taxes ; inconnue : tout le montant est réparti au kWh.
  fixed_fcfa    integer check (fixed_fcfa is null or fixed_fcfa >= 0),
  due_date      date,
  source        text not null default 'manuel' check (source in ('photo', 'manuel')),
  photo_path    text,
  created_at    timestamptz not null default now(),
  check (period_end > period_start and period_end - period_start <= 120),
  check (fixed_fcfa is null or fixed_fcfa < amount_fcfa),
  check (index_start is null or index_end is null or index_end >= index_start),
  unique (meter_id, period_end)
);

create index bills_meter_idx on public.bills (meter_id, period_end desc);

alter table public.bills enable row level security;
grant select, insert, delete on public.bills to authenticated;
grant all on public.bills to service_role;
create policy bills_read on public.bills for select to authenticated
  using (public.can_view_meter(meter_id) or public.is_staff());
create policy bills_insert on public.bills for insert to authenticated
  with check (user_id = auth.uid() and public.can_edit_meter(meter_id) and public.is_active_user());
create policy bills_delete on public.bills for delete to authenticated
  using (user_id = auth.uid() or public.owns_meter(meter_id));

-- Lecture d'une facture par photo.
alter table public.ai_reads drop constraint ai_reads_kind_check;
alter table public.ai_reads add constraint ai_reads_kind_check check (kind in ('compteur', 'recu', 'facture'));

-- ================================================================ bilan hebdomadaire (BF-21)
alter table public.profiles add column weekly_summary boolean not null default true;
grant update (weekly_summary) on public.profiles to authenticated;

alter table public.alerts drop constraint alerts_type_check;
alter table public.alerts add constraint alerts_type_check
  check (type in ('niveau_j5', 'niveau_j2', 'veille', 'veille_rappel', 'releve', 'anomalie', 'bilan', 'test'));

create or replace function public.admin_set_setting(p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb;
begin
  perform public.require_role(true);
  if p_key not in ('thresholds', 'hours', 'safetyMargin', 'readingReminderHours', 'anomalyRatio',
                   'defaultPriceKwh', 'channelTypes', 'unitCosts', 'templates', 'weeklySummary') then
    raise exception 'Réglage inconnu : %', p_key using errcode = '22023';
  end if;
  select value into v_old from public.settings where key = p_key;
  if p_value is null then
    delete from public.settings where key = p_key;
  else
    insert into public.settings (key, value, updated_at, updated_by)
    values (p_key, p_value, now(), auth.uid())
    on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
  end if;
  perform public.audit('setting.update', 'setting', p_key, jsonb_build_object('before', v_old, 'after', p_value));
end $$;

-- ================================================================ droits
grant all on public.meter_shares to service_role;
revoke execute on function public.my_email(), public.can_view_meter(uuid), public.can_edit_meter(uuid),
  public.share_meter(uuid, text, text, boolean), public.accept_share(uuid),
  public.update_share(uuid, text, boolean), public.remove_share(uuid) from public, anon;
grant execute on function public.my_email(), public.can_view_meter(uuid), public.can_edit_meter(uuid),
  public.share_meter(uuid, text, text, boolean), public.accept_share(uuid),
  public.update_share(uuid, text, boolean), public.remove_share(uuid) to authenticated, service_role;
