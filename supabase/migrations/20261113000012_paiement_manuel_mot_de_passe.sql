-- Paiement manuel et mot de passe oublié, tous deux traités par l'équipe.

-- ---------------------------------------------------------------- paiement manuel
-- Le client envoie le montant sur un numéro Wave, Orange Money, MTN MoMo ou
-- Moov Money affiché dans l'app, puis déclare l'identifiant de la transaction.
-- L'équipe vérifie sur son téléphone et valide : apply_payment active l'offre.
alter table public.payments
  add column reference       text check (reference is null or length(reference) between 4 and 40),
  add column payer_phone     text check (payer_phone is null or payer_phone ~ '^(01|05|07|21|25|27)[0-9]{8}$'),
  add column declared_amount integer check (declared_amount is null or declared_amount > 0),
  add column reviewed_by     uuid references public.profiles (id) on delete set null,
  add column refusal_reason  text check (refusal_reason is null or length(refusal_reason) <= 200);

-- Une même transaction ne sert qu'une fois (sauf si elle a été refusée,
-- pour pouvoir la redéclarer corrigée).
create unique index payments_reference_unique on public.payments (method, upper(reference))
  where reference is not null and status <> 'refused';
create index payments_pending_idx on public.payments (created_at) where status = 'pending';

-- ---------------------------------------------------------------- mot de passe oublié
-- Sans SMS ni email garanti : la personne fait une demande, l'équipe génère
-- un code à 6 chiffres et l'envoie par WhatsApp au numéro du compte. Le code
-- n'est gardé que sous forme d'empreinte ; 5 essais, valable 24 heures.
-- Lue et écrite par le serveur seulement.
create table public.password_resets (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id) on delete cascade,
  status           text not null default 'requested' check (status in ('requested', 'code_sent', 'used', 'closed')),
  code_hash        text,
  code_expires_at  timestamptz,
  attempts         integer not null default 0,
  created_at       timestamptz not null default now(),
  handled_by       uuid references public.profiles (id) on delete set null,
  handled_at       timestamptz
);
create index password_resets_user_idx on public.password_resets (user_id, created_at desc);
create index password_resets_open_idx on public.password_resets (created_at) where status in ('requested', 'code_sent');
alter table public.password_resets enable row level security;
revoke all on public.password_resets from public, anon, authenticated;
grant all on public.password_resets to service_role;

-- ---------------------------------------------------------------- réglage des numéros
create or replace function public.admin_set_setting(p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb;
  v_num text;
begin
  perform public.require_role(true);
  if p_key not in ('thresholds', 'hours', 'safetyMargin', 'readingReminderHours', 'anomalyRatio',
                   'defaultPriceKwh', 'channelTypes', 'unitCosts', 'templates', 'weeklySummary', 'trialDays',
                   'manualPayment') then
    raise exception 'Réglage inconnu : %', p_key using errcode = '22023';
  end if;
  if p_key = 'trialDays' and p_value is not null
     and (jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::numeric not between 0 and 90) then
    raise exception 'Durée d''essai entre 0 et 90 jours' using errcode = '22023';
  end if;
  if p_key = 'manualPayment' and p_value is not null then
    if jsonb_typeof(p_value) <> 'object' or jsonb_typeof(coalesce(p_value -> 'numbers', '{}')) <> 'object' then
      raise exception 'Réglage de paiement invalide' using errcode = '22023';
    end if;
    for v_num in select value #>> '{}' from jsonb_each(coalesce(p_value -> 'numbers', '{}')) loop
      if coalesce(v_num, '') <> '' and v_num !~ '^(01|05|07)[0-9]{8}$' then
        raise exception 'Numéro de paiement invalide : %', v_num using errcode = '22023';
      end if;
    end loop;
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
