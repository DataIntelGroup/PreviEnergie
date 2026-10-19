-- Fonctions du back-office (BF-26 à BF-32), d'expiration des offres (BF-23)
-- et d'activation des paiements (BF-22).
-- Toutes en security definer : chacune vérifie elle-même le rôle, et
-- EXECUTE est retiré à PUBLIC (PostgreSQL l'accorde par défaut).

-- ---------------------------------------------------------------- garde
create function public.require_role(p_admin boolean) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  -- coalesce : un appel sans session (auth.uid() nul) doit échouer, pas passer.
  if p_admin and not coalesce(public.is_admin(), false) then
    raise exception 'Réservé aux administrateurs' using errcode = '42501';
  end if;
  if not p_admin and not coalesce(public.is_staff(), false) then
    raise exception 'Réservé à l''équipe PréviÉnergie' using errcode = '42501';
  end if;
end $$;

create function public.audit(p_action text, p_target_type text, p_target_id text, p_details jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (auth.uid(), p_action, p_target_type, p_target_id, coalesce(p_details, '{}'::jsonb))
$$;

-- ---------------------------------------------------------------- utilisateurs (BF-30)
create function public.admin_users(p_query text default '', p_limit integer default 50, p_offset integer default 0)
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
             'created_at', m.created_at, 'last_seen_at', m.last_seen_at,
             'meters', (select count(*) from public.meters where user_id = m.id),
             'readings', (select count(*) from public.readings where user_id = m.id),
             'last_reading_at', (select max(taken_at) from public.readings where user_id = m.id)
           ) as row_data
    from matched m
  ) s;
  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;

create function public.admin_update_user(
  p_user uuid,
  p_plan text default null,
  p_plan_expires_at timestamptz default null,
  p_role public.user_role default null,
  p_suspended boolean default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_before public.profiles;
  v_after public.profiles;
begin
  perform public.require_role(true);
  select * into v_before from public.profiles where id = p_user for update;
  if not found then
    raise exception 'Utilisateur introuvable' using errcode = 'P0002';
  end if;
  if p_user = auth.uid() and p_role is not null and p_role <> 'admin' then
    raise exception 'Tu ne peux pas retirer ton propre rôle d''administrateur' using errcode = '42501';
  end if;
  if p_plan is not null and not exists (select 1 from public.plans where code = p_plan) then
    raise exception 'Offre inconnue : %', p_plan using errcode = '22023';
  end if;

  update public.profiles set
    plan_code = coalesce(p_plan, plan_code),
    plan_expires_at = case
      when p_plan = 'gratuit' then null
      when p_plan is not null then coalesce(p_plan_expires_at, now() + interval '30 days')
      when p_plan_expires_at is not null then p_plan_expires_at
      else plan_expires_at end,
    role = coalesce(p_role, role),
    suspended = coalesce(p_suspended, suspended)
  where id = p_user
  returning * into v_after;

  perform public.audit('user.update', 'profile', p_user::text, jsonb_build_object(
    'before', jsonb_build_object('plan', v_before.plan_code, 'expires', v_before.plan_expires_at,
                                 'role', v_before.role, 'suspended', v_before.suspended),
    'after', jsonb_build_object('plan', v_after.plan_code, 'expires', v_after.plan_expires_at,
                                'role', v_after.role, 'suspended', v_after.suspended)));
  return to_jsonb(v_after);
end $$;

-- ---------------------------------------------------------------- réglages et offres (BF-31)
create function public.admin_set_setting(p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb;
begin
  perform public.require_role(true);
  if p_key not in ('thresholds', 'hours', 'safetyMargin', 'readingReminderHours', 'anomalyRatio',
                   'defaultPriceKwh', 'channelTypes', 'unitCosts', 'templates') then
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

create function public.admin_update_plan(
  p_code text, p_name text, p_description text, p_price_fcfa integer,
  p_max_meters integer, p_channels text[], p_history_days integer, p_active boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_before public.plans;
  v_after public.plans;
begin
  perform public.require_role(true);
  select * into v_before from public.plans where code = p_code for update;
  if not found then
    raise exception 'Offre inconnue : %', p_code using errcode = 'P0002';
  end if;
  if p_code = 'gratuit' and (p_price_fcfa <> 0 or not p_active) then
    raise exception 'L''offre gratuite reste gratuite et active' using errcode = '22023';
  end if;
  update public.plans set
    name = p_name, description = p_description, price_fcfa = p_price_fcfa,
    max_meters = p_max_meters, channels = p_channels, history_days = p_history_days, active = p_active
  where code = p_code returning * into v_after;
  perform public.audit('plan.update', 'plan', p_code, jsonb_build_object('before', to_jsonb(v_before), 'after', to_jsonb(v_after)));
  return to_jsonb(v_after);
end $$;

-- ---------------------------------------------------------------- expiration des offres (BF-23)
create function public.expire_plans() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  with expired as (
    update public.profiles
    set plan_code = 'gratuit', plan_expires_at = null
    where plan_code <> 'gratuit' and plan_expires_at is not null and plan_expires_at <= now()
    returning id, plan_code
  )
  select count(*) into v_count from expired;
  if v_count > 0 then
    insert into public.audit_log (actor_id, action, target_type, details)
    values (null, 'plan.expire', 'profile', jsonb_build_object('count', v_count));
  end if;
  return v_count;
end $$;

-- ---------------------------------------------------------------- paiement accepté (BF-22)
-- Appelée par le serveur, uniquement après revérification auprès de CinetPay.
-- Idempotente : un second appel sur la même transaction ne prolonge rien.
create function public.apply_payment(p_transaction_id text, p_status text, p_method text, p_raw jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_pay public.payments;
  v_profile public.profiles;
  v_start timestamptz;
  v_end timestamptz;
begin
  if p_status not in ('accepted', 'refused', 'pending') then
    raise exception 'Statut invalide : %', p_status using errcode = '22023';
  end if;
  select * into v_pay from public.payments where transaction_id = p_transaction_id for update;
  if not found then
    raise exception 'Transaction inconnue' using errcode = 'P0002';
  end if;
  if v_pay.status <> 'pending' or p_status = 'pending' then
    return jsonb_build_object('status', v_pay.status, 'changed', false);
  end if;

  if p_status = 'refused' then
    update public.payments set status = 'refused', method = p_method, raw = p_raw, verified_at = now()
    where id = v_pay.id;
    return jsonb_build_object('status', 'refused', 'changed', true);
  end if;

  select * into v_profile from public.profiles where id = v_pay.user_id for update;
  -- Même offre encore valide : on prolonge à partir de l'échéance ; sinon à partir de maintenant.
  if v_profile.plan_code = v_pay.plan_code and v_profile.plan_expires_at > now() then
    v_start := v_profile.plan_expires_at;
  else
    v_start := now();
  end if;
  v_end := v_start + interval '30 days';

  update public.payments set status = 'accepted', method = p_method, raw = p_raw, verified_at = now(),
    period_start = v_start, period_end = v_end
  where id = v_pay.id;
  update public.profiles set plan_code = v_pay.plan_code, plan_expires_at = v_end where id = v_pay.user_id;
  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (null, 'payment.accepted', 'profile', v_pay.user_id::text,
          jsonb_build_object('transaction_id', p_transaction_id, 'plan', v_pay.plan_code,
                             'amount', v_pay.amount_fcfa, 'until', v_end));
  return jsonb_build_object('status', 'accepted', 'changed', true, 'until', v_end);
end $$;

-- ---------------------------------------------------------------- tableaux de bord (BF-26 à BF-29)
create function public.admin_dashboard(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_since timestamptz;
  v_days integer := greatest(1, least(coalesce(p_days, 30), 366));
  v_users integer;
  v_active integer;
  v_paying integer;
  v_signups jsonb;
  v_finance jsonb;
  v_costs jsonb;
  v_activity jsonb;
begin
  perform public.require_role(false);
  v_since := now() - make_interval(days => v_days);

  select count(*) into v_users from public.profiles where role = 'user';
  select count(distinct user_id) into v_active from public.readings where created_at >= v_since;
  select count(*) into v_paying from public.profiles
  where role = 'user' and public.effective_plan(id) <> 'gratuit';

  -- Inscriptions
  select jsonb_build_object(
    'total', v_users,
    'new', (select count(*) from public.profiles where role = 'user' and created_at >= v_since),
    'active', v_active,
    'complete', (select count(*) from public.profiles where role = 'user' and phone is not null),
    'byCommune', coalesce((select jsonb_agg(jsonb_build_object('label', k, 'value', n) order by n desc)
      from (select coalesce(commune, 'Non renseignée') k, count(*) n from public.profiles
            where role = 'user' group by 1 order by 2 desc limit 12) x), '[]'),
    'bySource', coalesce((select jsonb_agg(jsonb_build_object('label', k, 'value', n) order by n desc)
      from (select coalesce(source, 'Non renseignée') k, count(*) n from public.profiles
            where role = 'user' group by 1) x), '[]'),
    'byPlan', coalesce((select jsonb_agg(jsonb_build_object('label', k, 'value', n) order by n desc)
      from (select public.effective_plan(id) k, count(*) n from public.profiles
            where role = 'user' group by 1) x), '[]'),
    'byMeterKind', coalesce((select jsonb_agg(jsonb_build_object('label', k, 'value', n) order by n desc)
      from (select kind::text k, count(*) n from public.meters group by 1) x), '[]'),
    'series', coalesce((select jsonb_agg(jsonb_build_object('date', d, 'value', n) order by d)
      from (select g::date d, (select count(*) from public.profiles p
              where p.role = 'user' and p.created_at >= g and p.created_at < g + interval '1 day') n
            from generate_series(date_trunc('day', v_since), date_trunc('day', now()), interval '1 day') g) x), '[]')
  ) into v_signups;

  -- Finances
  select jsonb_build_object(
    'mrr', coalesce((select sum(pl.price_fcfa) from public.profiles p
                     join public.plans pl on pl.code = public.effective_plan(p.id)
                     where p.role = 'user'), 0),
    'collected', coalesce((select sum(amount_fcfa) from public.payments
                           where status = 'accepted' and verified_at >= v_since), 0),
    'paymentsCount', (select count(*) from public.payments where status = 'accepted' and verified_at >= v_since),
    'refusedCount', (select count(*) from public.payments where status = 'refused' and verified_at >= v_since),
    'paying', v_paying,
    'conversion', case when v_users > 0 then round(v_paying::numeric / v_users, 4) else 0 end,
    'byMethod', coalesce((select jsonb_agg(jsonb_build_object('label', k, 'value', n, 'amount', a) order by a desc)
      from (select coalesce(method, 'inconnu') k, count(*) n, sum(amount_fcfa) a from public.payments
            where status = 'accepted' and verified_at >= v_since group by 1) x), '[]'),
    'byPlan', coalesce((select jsonb_agg(jsonb_build_object('label', k, 'value', n, 'amount', a) order by a desc)
      from (select plan_code k, count(*) n, sum(amount_fcfa) a from public.payments
            where status = 'accepted' and verified_at >= v_since group by 1) x), '[]'),
    'recent', coalesce((select jsonb_agg(r order by created_at desc) from (
        select pa.created_at, jsonb_build_object('id', pa.id, 'created_at', pa.created_at, 'amount', pa.amount_fcfa,
               'plan', pa.plan_code, 'status', pa.status, 'method', pa.method,
               'name', btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), 'phone', p.phone) r
        from public.payments pa left join public.profiles p on p.id = pa.user_id
        order by pa.created_at desc limit 15) x), '[]'),
    'series', coalesce((select jsonb_agg(jsonb_build_object('date', d, 'value', n) order by d)
      from (select g::date d, coalesce((select sum(amount_fcfa) from public.payments
              where status = 'accepted' and verified_at >= g and verified_at < g + interval '1 day'), 0) n
            from generate_series(date_trunc('day', v_since), date_trunc('day', now()), interval '1 day') g) x), '[]')
  ) into v_finance;

  -- Coûts et marge
  with alert_costs as (
    select channel, count(*) n, coalesce(sum(cost_fcfa), 0) c
    from public.alerts where sent_at >= v_since and status = 'sent' group by channel
  ), ai as (
    select count(*) n, coalesce(sum(cost_fcfa), 0) c from public.ai_reads where created_at >= v_since
  ), per_plan_cost as (
    select public.effective_plan(u.id) plan, sum(u.c) c from (
      select user_id id, cost_fcfa c from public.alerts where sent_at >= v_since and status = 'sent'
      union all
      select user_id, cost_fcfa from public.ai_reads where created_at >= v_since
    ) u where u.id is not null group by 1
  ), per_plan_rev as (
    select plan_code plan, sum(amount_fcfa) r from public.payments
    where status = 'accepted' and verified_at >= v_since group by 1
  )
  select jsonb_build_object(
    'byChannel', coalesce((select jsonb_agg(jsonb_build_object('label', channel, 'value', c, 'count', n) order by c desc) from alert_costs), '[]'),
    'ai', (select jsonb_build_object('count', n, 'cost', c) from ai),
    'total', coalesce((select sum(c) from alert_costs), 0) + (select c from ai),
    'perActiveUser', case when v_active > 0
      then round((coalesce((select sum(c) from alert_costs), 0) + (select c from ai)) / v_active, 2) else 0 end,
    'marginByPlan', coalesce((select jsonb_agg(jsonb_build_object(
        'plan', pl.code, 'name', pl.name, 'revenue', coalesce(r.r, 0), 'cost', coalesce(c.c, 0),
        'margin', coalesce(r.r, 0) - coalesce(c.c, 0)) order by pl.sort)
      from public.plans pl left join per_plan_rev r on r.plan = pl.code left join per_plan_cost c on c.plan = pl.code), '[]')
  ) into v_costs;

  -- Activité
  select jsonb_build_object(
    'readings', (select count(*) from public.readings where created_at >= v_since),
    'readingsBySource', coalesce((select jsonb_agg(jsonb_build_object('label', source, 'value', n))
      from (select source, count(*) n from public.readings where created_at >= v_since group by 1) x), '[]'),
    'recharges', (select count(*) from public.recharges where created_at >= v_since),
    'aiReads', (select count(*) from public.ai_reads where created_at >= v_since),
    'aiSuccessRate', coalesce((select round(avg(case when success then 1 else 0 end)::numeric, 4)
      from public.ai_reads where created_at >= v_since), 0),
    'retention7', coalesce((select round(avg(case when exists (
        select 1 from public.readings r where r.user_id = p.id and r.created_at >= now() - interval '7 days')
        then 1 else 0 end)::numeric, 4)
      from public.profiles p where p.role = 'user' and p.created_at <= now() - interval '7 days'), 0),
    'retention30', coalesce((select round(avg(case when exists (
        select 1 from public.readings r where r.user_id = p.id and r.created_at >= now() - interval '7 days')
        then 1 else 0 end)::numeric, 4)
      from public.profiles p where p.role = 'user' and p.created_at <= now() - interval '30 days'), 0),
    'alertsByChannel', coalesce((select jsonb_agg(jsonb_build_object('label', channel, 'value', n) order by n desc)
      from (select channel, count(*) n from public.alerts where sent_at >= v_since and status = 'sent' group by 1) x), '[]'),
    'alertsByType', coalesce((select jsonb_agg(jsonb_build_object('label', type, 'value', n) order by n desc)
      from (select type, count(*) n from public.alerts where sent_at >= v_since and status = 'sent' group by 1) x), '[]'),
    'alertsFailed', (select count(*) from public.alerts where sent_at >= v_since and status = 'failed'),
    'avoidedCutoffs', (select count(*) from public.cutoff_feedback where created_at >= v_since and not was_cut),
    'reportedCutoffs', (select count(*) from public.cutoff_feedback where created_at >= v_since and was_cut),
    'series', coalesce((select jsonb_agg(jsonb_build_object('date', d, 'value', n) order by d)
      from (select g::date d, (select count(*) from public.readings r
              where r.created_at >= g and r.created_at < g + interval '1 day') n
            from generate_series(date_trunc('day', v_since), date_trunc('day', now()), interval '1 day') g) x), '[]')
  ) into v_activity;

  return jsonb_build_object('days', v_days, 'generatedAt', now(),
    'signups', v_signups, 'finance', v_finance, 'costs', v_costs, 'activity', v_activity);
end $$;

-- ---------------------------------------------------------------- abonnement push
-- Un appareil appartient au dernier compte qui s'y est abonné : sans cette
-- fonction, la RLS empêcherait de reprendre l'abonnement d'un autre compte.
create function public.register_push(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;
  if p_endpoint !~ '^https://' or length(p_endpoint) > 1000 then
    raise exception 'Abonnement invalide' using errcode = '22023';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 200))
  on conflict (endpoint) do update
    set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, created_at = now();
end $$;

-- ---------------------------------------------------------------- droits d'exécution
revoke execute on all functions in schema public from public, anon;

grant execute on function public.is_staff(), public.is_admin(), public.is_active_user(),
  public.effective_plan(uuid), public.owns_meter(uuid),
  public.register_push(text, text, text, text) to authenticated;
grant execute on function public.admin_users(text, integer, integer),
  public.admin_update_user(uuid, text, timestamptz, public.user_role, boolean),
  public.admin_set_setting(text, jsonb),
  public.admin_update_plan(text, text, text, integer, integer, text[], integer, boolean),
  public.admin_dashboard(integer) to authenticated;

-- Réservées au serveur.
revoke execute on function public.expire_plans(), public.apply_payment(text, text, text, jsonb),
  public.audit(text, text, text, jsonb), public.require_role(boolean) from authenticated;
grant execute on all functions in schema public to service_role;

-- Les fonctions créées plus tard ne doivent pas s'ouvrir toutes seules.
alter default privileges in schema public revoke execute on functions from public, anon;
