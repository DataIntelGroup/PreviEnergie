-- Grille tarifaire du 2026-10-20 : plus d'offre gratuite permanente.
-- Essai gratuit de 7 jours à l'inscription, puis Découverte à 300 FCFA/mois
-- (le contenu de l'ancien Gratuit), Essentiel 1 000, Famille / Pro 2 500,
-- Entreprise 5 000. Essai terminé sans paiement : compte en lecture seule
-- (historique visible, plus de saisie ni d'alertes).

-- ---------------------------------------------------------------- essai
alter table public.profiles add column trial_ends_at timestamptz;
-- Comptes existants : 7 jours à partir de leur inscription.
update public.profiles set trial_ends_at = created_at + interval '7 days' where trial_ends_at is null;
alter table public.profiles alter column trial_ends_at set default now() + interval '7 days';
alter table public.profiles alter column trial_ends_at set not null;

-- Durée de l'essai réglable dans le back-office (clé trialDays), 7 jours par défaut.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_days integer;
begin
  select (value #>> '{}')::integer into v_days from public.settings where key = 'trialDays';
  insert into public.profiles (id, email, source, trial_ends_at)
  values (new.id, new.email, nullif(new.raw_user_meta_data ->> 'source', ''),
          now() + make_interval(days => coalesce(v_days, 7)))
  on conflict (id) do nothing;
  return new;
end $$;

-- Accès : offre payante en cours, ou essai pas encore terminé.
create function public.access_status(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when p.plan_code <> 'gratuit' and (p.plan_expires_at is null or p.plan_expires_at > now()) then 'paid'
    when p.trial_ends_at > now() then 'trial'
    else 'expired'
  end
  from public.profiles p where p.id = p_user
$$;

create function public.has_access(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.access_status(p_user) in ('paid', 'trial'), false)
$$;

-- Saisir (compteur, relevé, recharge, facture) demande un profil complet,
-- un compte non suspendu et un accès en cours : sinon, lecture seule.
create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select not suspended and first_name is not null and last_name is not null and phone is not null
           and public.has_access(id)
    from public.profiles where id = auth.uid()
  ), false)
$$;

-- ---------------------------------------------------------------- offres
update public.plans
set name = 'Essai gratuit',
    description = '7 jours pour tout essayer : 1 compteur, prévision, alertes par notification et email'
where code = 'gratuit';

update public.plans set sort = sort + 1 where sort >= 1;
insert into public.plans (code, name, description, price_fcfa, max_meters, channels, history_days, sort)
values ('decouverte', 'Découverte', '1 compteur, prévision, alertes par notification et email, 30 jours d''historique',
        300, 1, array['push', 'email'], 30, 1)
on conflict (code) do nothing;

-- ---------------------------------------------------------------- réglage
create or replace function public.admin_set_setting(p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb;
begin
  perform public.require_role(true);
  if p_key not in ('thresholds', 'hours', 'safetyMargin', 'readingReminderHours', 'anomalyRatio',
                   'defaultPriceKwh', 'channelTypes', 'unitCosts', 'templates', 'weeklySummary', 'trialDays') then
    raise exception 'Réglage inconnu : %', p_key using errcode = '22023';
  end if;
  if p_key = 'trialDays' and p_value is not null
     and (jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::numeric not between 0 and 90) then
    raise exception 'Durée d''essai entre 0 et 90 jours' using errcode = '22023';
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

-- ---------------------------------------------------------------- tableau de bord
-- Abonnés en essai, essais terminés sans paiement, et passage à une offre payante.
create function public.admin_trial_stats() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_role(false);
  return (
    select jsonb_build_object(
      'trial', count(*) filter (where public.access_status(id) = 'trial'),
      'expired', count(*) filter (where public.access_status(id) = 'expired'),
      'paid', count(*) filter (where public.access_status(id) = 'paid'),
      'trialEndingSoon', count(*) filter (where public.access_status(id) = 'trial' and trial_ends_at <= now() + interval '2 days')
    )
    from public.profiles where role = 'user'
  );
end $$;

-- ---------------------------------------------------------------- droits
-- access_status et has_access restent internes : un utilisateur n'interroge
-- pas le statut d'un autre. Les fonctions security definer (is_active_user,
-- admin_trial_stats) les appellent avec les droits de leur propriétaire.
revoke execute on function public.access_status(uuid), public.has_access(uuid), public.admin_trial_stats() from public, anon, authenticated;
grant execute on function public.access_status(uuid), public.has_access(uuid) to service_role;
grant execute on function public.admin_trial_stats() to authenticated, service_role;
