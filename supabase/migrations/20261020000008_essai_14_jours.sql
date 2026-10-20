-- Décision du 2026-10-20 (remplace la grille du matin) : 14 jours d'essai
-- gratuit, puis Essentiel 1 000, Famille / Pro 2 500 ou Entreprise 5 000 FCFA.
-- L'offre Découverte (300 FCFA) n'est plus proposée.

alter table public.profiles alter column trial_ends_at set default now() + interval '14 days';

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_days integer;
begin
  select (value #>> '{}')::integer into v_days from public.settings where key = 'trialDays';
  insert into public.profiles (id, email, source, trial_ends_at)
  values (new.id, new.email, nullif(new.raw_user_meta_data ->> 'source', ''),
          now() + make_interval(days => coalesce(v_days, 14)))
  on conflict (id) do nothing;
  return new;
end $$;

-- Les essais de 7 jours accordés ce matin passent à 14 jours.
update public.profiles
set trial_ends_at = created_at + interval '14 days'
where trial_ends_at = created_at + interval '7 days';

update public.plans set active = false where code = 'decouverte';
update public.plans
set description = '14 jours pour tout essayer : 1 compteur, prévision, alertes par notification et email'
where code = 'gratuit';
