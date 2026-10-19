-- PréviÉnergie : schéma, règles d'accès (RLS) et droits.
-- Principe : un utilisateur ne lit et n'écrit que ses lignes ; tout ce qui
-- touche à l'argent, aux offres, aux rôles et aux réglages passe par le
-- serveur (service_role) ou par des fonctions qui vérifient le rôle admin.

-- ---------------------------------------------------------------- types
create type public.user_role as enum ('user', 'support', 'admin');
create type public.meter_kind as enum ('prepaid', 'postpaid');

-- ---------------------------------------------------------------- offres
create table public.plans (
  code         text primary key,
  name         text not null,
  description  text not null default '',
  price_fcfa   integer not null check (price_fcfa >= 0 and price_fcfa % 5 = 0),
  max_meters   integer not null check (max_meters between 1 and 50),
  channels     text[] not null check (channels <@ array['push', 'email', 'whatsapp', 'sms']),
  history_days integer check (history_days is null or history_days > 0),
  sort         integer not null default 0,
  active       boolean not null default true
);

insert into public.plans (code, name, description, price_fcfa, max_meters, channels, history_days, sort) values
  ('gratuit', 'Gratuit', '1 compteur, prévision, alertes par notification et email, 30 jours d''historique',
   0, 1, array['push', 'email'], 30, 0),
  ('essentiel', 'Essentiel', '2 compteurs, alertes WhatsApp et SMS urgents, historique illimité',
   1000, 2, array['push', 'email', 'whatsapp', 'sms'], null, 1),
  ('famille_pro', 'Famille / Pro', 'Jusqu''à 5 compteurs, mêmes canaux, historique illimité',
   2500, 5, array['push', 'email', 'whatsapp', 'sms'], null, 2);

-- ---------------------------------------------------------------- profils
create table public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  email            text,
  first_name       text check (first_name is null or length(btrim(first_name)) between 1 and 60),
  last_name        text check (last_name is null or length(btrim(last_name)) between 1 and 60),
  phone            text check (phone is null or phone ~ '^(01|05|07|21|25|27)[0-9]{8}$'),
  commune          text check (commune is null or length(commune) <= 60),
  source           text check (source is null or length(source) <= 60),
  role             public.user_role not null default 'user',
  plan_code        text not null default 'gratuit' references public.plans (code),
  plan_expires_at  timestamptz,
  suspended        boolean not null default false,
  channels         text[] not null default array['push', 'email']
                   check (channels <@ array['push', 'email', 'whatsapp', 'sms']),
  whatsapp_consent_at timestamptz,
  sms_consent_at   timestamptz,
  quiet_start      text not null default '21:30' check (quiet_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  quiet_end        text not null default '07:00' check (quiet_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  last_seen_at     timestamptz
);

create index profiles_created_idx on public.profiles (created_at);

-- Profil vide créé à la première connexion (BF-01) ; l'application exige
-- ensuite prénom, nom et téléphone avant tout accès (BF-02).
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, source)
  values (new.id, new.email, nullif(new.raw_user_meta_data ->> 'source', ''))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- fonctions d'aide
-- security definer : lisent profiles sans repasser par ses propres règles.
create function public.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select role in ('admin', 'support') from public.profiles where id = auth.uid()), false)
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false)
$$;

-- Compte utilisable : profil complet et non suspendu.
create function public.is_active_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select not suspended and first_name is not null and last_name is not null and phone is not null
    from public.profiles where id = auth.uid()
  ), false)
$$;

-- Offre en vigueur : une offre payante échue retombe sur « gratuit »,
-- même si la tâche d'expiration n'est pas encore passée (BF-23).
create function public.effective_plan(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when p.plan_code <> 'gratuit' and (p.plan_expires_at is null or p.plan_expires_at > now()) then p.plan_code
    else 'gratuit'
  end
  from public.profiles p where p.id = p_user
$$;

-- ---------------------------------------------------------------- compteurs
create table public.meters (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 40),
  kind        public.meter_kind not null default 'prepaid',
  number      text check (number is null or length(number) <= 40),
  created_at  timestamptz not null default now()
);

create index meters_user_idx on public.meters (user_id);

-- Nombre de compteurs limité par l'offre (BF-04).
create function public.enforce_meter_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_limit integer;
  v_count integer;
begin
  -- Le déclencheur passe avant la RLS : on refuse d'abord l'usurpation,
  -- pour ne pas compter les compteurs d'un autre compte.
  if auth.uid() is not null and new.user_id is distinct from auth.uid() then
    raise exception 'Compteur réservé à son propriétaire' using errcode = '42501';
  end if;
  select pl.max_meters into v_limit
  from public.plans pl where pl.code = public.effective_plan(new.user_id);
  select count(*) into v_count from public.meters where user_id = new.user_id;
  if v_count >= coalesce(v_limit, 1) then
    raise exception 'Ton offre permet % compteur(s). Passe à une offre supérieure pour en ajouter.', coalesce(v_limit, 1)
      using errcode = 'P0001', hint = 'meter_limit';
  end if;
  return new;
end $$;

create trigger meters_limit before insert on public.meters
  for each row execute function public.enforce_meter_limit();

-- ---------------------------------------------------------------- relevés
create table public.readings (
  id            uuid primary key default gen_random_uuid(),
  meter_id      uuid not null references public.meters (id) on delete cascade,
  user_id       uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  taken_at      timestamptz not null default now(),
  value         numeric(12, 2) not null check (value >= 0),
  source        text not null default 'manuel' check (source in ('photo', 'manuel')),
  photo_path    text,
  ai_value      numeric(12, 2),
  ai_confidence numeric(4, 3),
  created_at    timestamptz not null default now()
);

create index readings_meter_idx on public.readings (meter_id, taken_at);
create index readings_created_idx on public.readings (created_at);

-- ---------------------------------------------------------------- recharges
create table public.recharges (
  id              uuid primary key default gen_random_uuid(),
  meter_id        uuid not null references public.meters (id) on delete cascade,
  user_id         uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  purchased_at    timestamptz not null default now(),
  kwh             numeric(12, 2) not null check (kwh > 0),
  amount_fcfa     integer not null default 0 check (amount_fcfa >= 0),
  code            text check (code is null or length(code) <= 40),
  payment_method  text check (payment_method is null or payment_method in
                  ('wave', 'orange_money', 'mtn_momo', 'moov_money', 'carte', 'especes', 'autre')),
  source          text not null default 'manuel' check (source in ('photo', 'manuel', 'sms')),
  photo_path      text,
  created_at      timestamptz not null default now()
);

create index recharges_meter_idx on public.recharges (meter_id, purchased_at);

-- Le compteur d'un relevé ou d'une recharge doit appartenir à son auteur.
create function public.owns_meter(p_meter uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.meters where id = p_meter and user_id = auth.uid())
$$;

-- ---------------------------------------------------------------- prévisions (écrites par le serveur)
create table public.forecasts (
  meter_id        uuid primary key references public.meters (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  computed_at     timestamptz not null default now(),
  status          text not null check (status in ('insufficient', 'preliminary', 'standard')),
  avg_kwh_day     numeric(12, 3),
  balance_kwh     numeric(12, 2),
  days_remaining  numeric(8, 2),
  cutoff_at       timestamptz,
  cycle_key       text not null,
  anomaly         boolean not null default false
);

-- ---------------------------------------------------------------- alertes envoyées
create table public.alerts (
  id          bigint generated always as identity primary key,
  user_id     uuid references public.profiles (id) on delete cascade,
  meter_id    uuid references public.meters (id) on delete cascade,
  type        text not null check (type in ('niveau_j5', 'niveau_j2', 'veille', 'veille_rappel', 'releve', 'anomalie', 'test')),
  channel     text not null check (channel in ('push', 'email', 'whatsapp', 'sms')),
  cycle_key   text not null,
  status      text not null check (status in ('sent', 'failed')),
  cost_fcfa   numeric(10, 2) not null default 0,
  message     text,
  error       text,
  sent_at     timestamptz not null default now(),
  unique (meter_id, type, cycle_key, channel)
);

create index alerts_sent_idx on public.alerts (sent_at);
create index alerts_user_idx on public.alerts (user_id, sent_at desc);

-- ---------------------------------------------------------------- abonnements Web Push
create table public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- paiements (écrits par le serveur)
create table public.payments (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references public.profiles (id) on delete set null,
  plan_code       text not null references public.plans (code),
  amount_fcfa     integer not null check (amount_fcfa > 0 and amount_fcfa % 5 = 0),
  transaction_id  text not null unique,
  status          text not null default 'pending' check (status in ('pending', 'accepted', 'refused')),
  method          text,
  period_start    timestamptz,
  period_end      timestamptz,
  raw             jsonb,
  created_at      timestamptz not null default now(),
  verified_at     timestamptz
);

create index payments_user_idx on public.payments (user_id, created_at desc);
create index payments_status_idx on public.payments (status, verified_at);

-- ---------------------------------------------------------------- « As-tu été coupé ? » (BF-13)
create table public.cutoff_feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  meter_id    uuid not null references public.meters (id) on delete cascade,
  cycle_key   text not null,
  was_cut     boolean not null,
  created_at  timestamptz not null default now(),
  unique (meter_id, cycle_key)
);

-- ---------------------------------------------------------------- lectures IA (coûts, taux de réussite)
create table public.ai_reads (
  id          bigint generated always as identity primary key,
  user_id     uuid references public.profiles (id) on delete set null,
  kind        text not null check (kind in ('compteur', 'recu')),
  success     boolean not null,
  confidence  numeric(4, 3),
  cost_fcfa   numeric(10, 2) not null default 0,
  model       text,
  created_at  timestamptz not null default now()
);

create index ai_reads_created_idx on public.ai_reads (created_at);
create index ai_reads_user_idx on public.ai_reads (user_id, created_at);

-- ---------------------------------------------------------------- réglages et journal
create table public.settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null
);

create table public.audit_log (
  id           bigint generated always as identity primary key,
  actor_id     uuid references public.profiles (id) on delete set null,
  action       text not null,
  target_type  text,
  target_id    text,
  details      jsonb not null default '{}',
  created_at   timestamptz not null default now()
);

create index audit_created_idx on public.audit_log (created_at desc);

-- ================================================================ droits
-- Supabase accorde par défaut tout à anon et authenticated sur public :
-- on repart de zéro, puis on n'ouvre que le nécessaire.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

alter table public.plans              enable row level security;
alter table public.profiles           enable row level security;
alter table public.meters             enable row level security;
alter table public.readings           enable row level security;
alter table public.recharges          enable row level security;
alter table public.forecasts          enable row level security;
alter table public.alerts             enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.payments           enable row level security;
alter table public.cutoff_feedback    enable row level security;
alter table public.ai_reads           enable row level security;
alter table public.settings           enable row level security;
alter table public.audit_log          enable row level security;

-- Offres : lisibles par tous les connectés ; modifiées par admin_update_plan.
grant select on public.plans to authenticated;
create policy plans_read on public.plans for select to authenticated using (true);

-- Profils : chacun lit le sien, l'équipe lit tout. Offre, rôle et suspension
-- ne sont pas modifiables par l'utilisateur (droits par colonne).
grant select on public.profiles to authenticated;
grant update (first_name, last_name, phone, commune, source, channels,
              whatsapp_consent_at, sms_consent_at, quiet_start, quiet_end, last_seen_at)
  on public.profiles to authenticated;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Compteurs
grant select, insert, delete on public.meters to authenticated;
grant update (name, kind, number) on public.meters to authenticated;
create policy meters_read on public.meters for select to authenticated
  using (user_id = auth.uid() or public.is_staff());
create policy meters_insert on public.meters for insert to authenticated
  with check (user_id = auth.uid() and public.is_active_user());
create policy meters_update on public.meters for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy meters_delete on public.meters for delete to authenticated
  using (user_id = auth.uid());

-- Relevés et recharges : même schéma.
grant select, insert, delete on public.readings to authenticated;
create policy readings_read on public.readings for select to authenticated
  using (user_id = auth.uid() or public.is_staff());
create policy readings_insert on public.readings for insert to authenticated
  with check (user_id = auth.uid() and public.owns_meter(meter_id) and public.is_active_user());
create policy readings_delete on public.readings for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, delete on public.recharges to authenticated;
create policy recharges_read on public.recharges for select to authenticated
  using (user_id = auth.uid() or public.is_staff());
create policy recharges_insert on public.recharges for insert to authenticated
  with check (user_id = auth.uid() and public.owns_meter(meter_id) and public.is_active_user());
create policy recharges_delete on public.recharges for delete to authenticated
  using (user_id = auth.uid());

-- Prévisions, alertes, paiements : lecture seule pour l'utilisateur.
grant select on public.forecasts to authenticated;
create policy forecasts_read on public.forecasts for select to authenticated
  using (user_id = auth.uid() or public.is_staff());

grant select on public.alerts to authenticated;
create policy alerts_read on public.alerts for select to authenticated
  using (user_id = auth.uid() or public.is_staff());

grant select on public.payments to authenticated;
create policy payments_read on public.payments for select to authenticated
  using (user_id = auth.uid() or public.is_staff());

-- Abonnements push
grant select, insert, delete on public.push_subscriptions to authenticated;
create policy push_read on public.push_subscriptions for select to authenticated
  using (user_id = auth.uid());
create policy push_insert on public.push_subscriptions for insert to authenticated
  with check (user_id = auth.uid());
create policy push_delete on public.push_subscriptions for delete to authenticated
  using (user_id = auth.uid());

-- Retour « As-tu été coupé ? »
grant select, insert on public.cutoff_feedback to authenticated;
create policy feedback_read on public.cutoff_feedback for select to authenticated
  using (user_id = auth.uid() or public.is_staff());
create policy feedback_insert on public.cutoff_feedback for insert to authenticated
  with check (user_id = auth.uid() and public.owns_meter(meter_id));

-- Réglages : lisibles par les connectés (seuils, heures), écrits par admin_set_setting.
grant select on public.settings to authenticated;
create policy settings_read on public.settings for select to authenticated using (true);

-- Journal : lecture par l'équipe.
grant select on public.audit_log to authenticated;
create policy audit_read on public.audit_log for select to authenticated using (public.is_staff());

-- ai_reads : aucune politique pour authenticated, réservé au serveur.

-- Le serveur (fonctions Edge, tâche horaire) passe par service_role, qui
-- contourne la RLS mais a besoin des droits de table.
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
