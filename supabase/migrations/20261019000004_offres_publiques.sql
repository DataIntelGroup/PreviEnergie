-- Les tarifs s'affichent sur la page d'accueil publique : un visiteur non
-- connecté lit les offres actives, et rien d'autre.
grant select on public.plans to anon;
create policy plans_public_read on public.plans for select to anon using (active);
