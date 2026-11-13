-- Connexion par email ou numéro de téléphone, avec mot de passe.

-- Un numéro identifie un seul compte (il sert d'identifiant de connexion).
create unique index profiles_phone_unique on public.profiles (phone) where phone is not null;

-- Tentatives de connexion par numéro (fonction connexion) : au-delà de 5
-- échecs en 15 minutes pour un numéro, la fonction refuse d'essayer.
-- Lue et écrite par le serveur seulement.
create table public.login_attempts (
  id          bigint generated always as identity primary key,
  phone       text not null,
  success     boolean not null,
  created_at  timestamptz not null default now()
);
create index login_attempts_phone_idx on public.login_attempts (phone, created_at desc);
alter table public.login_attempts enable row level security;
revoke all on public.login_attempts from public, anon, authenticated;
grant all on public.login_attempts to service_role;
