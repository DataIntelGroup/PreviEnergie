-- Offre pour ceux qui suivent plus de 5 compteurs (bailleurs, commerces,
-- entreprises) : décision du 2026-10-19, 5 000 FCFA par mois.
insert into public.plans (code, name, description, price_fcfa, max_meters, channels, history_days, sort)
values ('entreprise', 'Entreprise', 'Plus de 5 compteurs (jusqu''à 50), mêmes canaux, historique illimité',
        5000, 50, array['push', 'email', 'whatsapp', 'sms'], null, 3)
on conflict (code) do nothing;
