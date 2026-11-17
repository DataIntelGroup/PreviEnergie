-- Offrir des jours d'une offre payante à un client (geste commercial,
-- dédommagement, partenaire). Même offre encore valide : les jours s'ajoutent
-- à son échéance ; sinon ils partent d'aujourd'hui. Aucun paiement n'est créé.
create function public.admin_gift_plan(p_user uuid, p_plan text, p_days integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_before public.profiles;
  v_after timestamptz;
begin
  perform public.require_role(true);
  if p_days is null or p_days < 1 or p_days > 366 then
    raise exception 'Durée invalide : de 1 à 366 jours' using errcode = '22023';
  end if;
  if not exists (select 1 from public.plans where code = p_plan and active and price_fcfa > 0) then
    raise exception 'Offre invalide : %', p_plan using errcode = '22023';
  end if;
  select * into v_before from public.profiles where id = p_user for update;
  if not found then
    raise exception 'Utilisateur introuvable' using errcode = 'P0002';
  end if;
  update public.profiles
     set plan_code = p_plan,
         plan_expires_at = case
           when v_before.plan_code = p_plan and v_before.plan_expires_at > now() then v_before.plan_expires_at
           else now() end + make_interval(days => p_days)
   where id = p_user
  returning plan_expires_at into v_after;
  perform public.audit('user.gift', 'profile', p_user::text, jsonb_build_object(
    'plan', p_plan, 'days', p_days,
    'before', jsonb_build_object('plan', v_before.plan_code, 'expires', v_before.plan_expires_at),
    'after', v_after));
  return jsonb_build_object('plan_code', p_plan, 'plan_expires_at', v_after);
end $$;

revoke execute on function public.admin_gift_plan(uuid, text, integer) from public, anon;
grant execute on function public.admin_gift_plan(uuid, text, integer) to authenticated, service_role;
