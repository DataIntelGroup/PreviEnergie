-- Actions de l'équipe sur les clients : messages (push, email), prolongation
-- d'essai, et informations utiles dans la liste des utilisateurs.

-- Messages envoyés par l'équipe depuis le back-office (fonction admin-clients).
alter table public.alerts drop constraint alerts_type_check;
alter table public.alerts add constraint alerts_type_check
  check (type in ('niveau_j5', 'niveau_j2', 'veille', 'veille_rappel', 'releve', 'anomalie', 'bilan', 'test', 'message'));

-- Prolonger l'essai gratuit d'un client (geste commercial), de 1 à 60 jours,
-- à partir d'aujourd'hui si l'essai est déjà fini.
create function public.admin_extend_trial(p_user uuid, p_days integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_before timestamptz;
  v_after timestamptz;
begin
  perform public.require_role(true);
  if p_days is null or p_days < 1 or p_days > 60 then
    raise exception 'Durée invalide : de 1 à 60 jours' using errcode = '22023';
  end if;
  select trial_ends_at into v_before from public.profiles where id = p_user for update;
  if not found then
    raise exception 'Utilisateur introuvable' using errcode = 'P0002';
  end if;
  update public.profiles
     set trial_ends_at = greatest(trial_ends_at, now()) + make_interval(days => p_days)
   where id = p_user
  returning trial_ends_at into v_after;
  perform public.audit('user.trial', 'profile', p_user::text,
    jsonb_build_object('days', p_days, 'before', v_before, 'after', v_after));
  return jsonb_build_object('trial_ends_at', v_after);
end $$;

revoke execute on function public.admin_extend_trial(uuid, integer) from public, anon;
grant execute on function public.admin_extend_trial(uuid, integer) to authenticated, service_role;

-- Liste des utilisateurs : fin d'essai, statut d'accès et appareils abonnés aux notifications.
create or replace function public.admin_users(p_query text default '', p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_q text := '%' || lower(btrim(coalesce(p_query, ''))) || '%';
  v_digits text := regexp_replace(coalesce(p_query, ''), '\D', '', 'g');
  v_rows jsonb;
  v_total integer;
begin
  perform public.require_role(false);
  with matched as (
    select p.*
    from public.profiles p
    where btrim(coalesce(p_query, '')) = ''
       or lower(coalesce(p.first_name, '')) like v_q
       or lower(coalesce(p.last_name, '')) like v_q
       or lower(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')) like v_q
       or lower(coalesce(p.last_name, '') || ' ' || coalesce(p.first_name, '')) like v_q
       or lower(coalesce(p.email, '')) like v_q
       or (length(v_digits) >= 2 and p.phone like '%' || v_digits || '%')
  )
  select count(*)::integer,
         coalesce(jsonb_agg(row_data order by created_at desc) filter (where rn > p_offset and rn <= p_offset + p_limit), '[]'::jsonb)
  into v_total, v_rows
  from (
    select m.created_at,
           row_number() over (order by m.created_at desc) as rn,
           jsonb_build_object(
             'id', m.id, 'email', m.email, 'first_name', m.first_name, 'last_name', m.last_name,
             'phone', m.phone, 'commune', m.commune, 'source', m.source, 'role', m.role,
             'plan_code', m.plan_code, 'effective_plan', public.effective_plan(m.id),
             'plan_expires_at', m.plan_expires_at, 'suspended', m.suspended,
             'trial_ends_at', m.trial_ends_at, 'access', public.access_status(m.id),
             'created_at', m.created_at, 'last_seen_at', m.last_seen_at,
             'meters', (select count(*) from public.meters where user_id = m.id),
             'readings', (select count(*) from public.readings where user_id = m.id),
             'last_reading_at', (select max(taken_at) from public.readings where user_id = m.id),
             'push_devices', (select count(*) from public.push_subscriptions where user_id = m.id)
           ) as row_data
    from matched m
  ) s;
  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;
