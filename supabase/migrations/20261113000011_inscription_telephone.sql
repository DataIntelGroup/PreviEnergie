-- Création de compte avec un numéro de téléphone et un mot de passe.
-- Sans fournisseur SMS, le compte Supabase reçoit une adresse interne
-- <numéro>@telephone.previenergie.invalid (fonction inscription). Le profil
-- ne garde pas cette adresse : email vide (aucun envoi d'email possible),
-- numéro renseigné tout de suite, alertes par notification seulement.

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_days integer;
  v_phone_only boolean := coalesce(lower(new.email) like '%@telephone.previenergie.invalid', false);
begin
  select (value #>> '{}')::integer into v_days from public.settings where key = 'trialDays';
  insert into public.profiles (id, email, phone, channels, source, trial_ends_at)
  values (
    new.id,
    case when v_phone_only then null else new.email end,
    case when v_phone_only then nullif(new.raw_user_meta_data ->> 'phone', '') end,
    case when v_phone_only then array['push'] else array['push', 'email'] end,
    nullif(new.raw_user_meta_data ->> 'source', ''),
    now() + make_interval(days => coalesce(v_days, 14))
  )
  on conflict (id) do nothing;
  return new;
end $$;
