# PréviÉnergie : consignes pour Claude Code

Lire d'abord `README.md` (architecture, commandes, mise en ligne) et `docs/EXPRESSION_DE_BESOIN.md` (besoins BF-xx).

## Règles du projet

- Tout texte visible est en français, au tutoiement. Mention « Service indépendant, non affilié à la CIE » visible ; jamais de logo ni de charte CIE.
- Adresses : page publique sur `/`, application sous `/app`, back-office sous `/admin`. Tout lien passe par `src/lib/routes.ts` (`R`, `withQuery`, `safeNext`), jamais une chaîne écrite à la main ; côté serveur, `appLink("/app/…")` dans `_shared/canaux.ts`. Les anciennes adresses (`/releve`, `/offres`…) redirigent vers `/app/…` : ne pas les retirer, des liens d'alertes déjà envoyés les utilisent.
- Heure d'Abidjan (UTC+0) partout : passer par `supabase/functions/_shared/temps.ts` et `src/lib/format.ts`.
- Le moteur (`_shared/prevision.ts`, `_shared/alertes.ts`) est partagé entre l'app et les fonctions Deno : pas d'import Node ni Deno dedans, imports relatifs avec l'extension `.ts`. Toute règle métier nouvelle s'y écrit avec ses tests dans `tests/`.
- Les fichiers `_shared/serveur.ts`, `canaux.ts`, `cinetpay.ts`, `donnees.ts` sont réservés au serveur (clé service_role) : ne jamais les importer depuis `src/`.
- Un nouveau réglage : l'ajouter à `DEFAULT_SETTINGS` (`_shared/reglages.ts`) **et** à la liste autorisée de `admin_set_setting` (nouvelle migration), puis à `src/admin/Reglages.tsx`.
- Base : jamais modifier une migration déjà appliquée en production ; en ajouter une. Toute table nouvelle : RLS activée, droits accordés explicitement (les migrations retirent les droits par défaut de Supabase), fonctions en `security definer set search_path = ''` avec `coalesce(...)` sur les tests de rôle, `revoke execute ... from public, anon`.
- Avant de livrer : `npm run check` (types, Vitest, contrôles SQL) et `deno check` des fonctions.

## Pièges connus sur ce poste

- Proxy d'entreprise : les scripts Node qui appellent internet passent `--use-env-proxy` (déjà dans `npm run deploy`).
- La base Supabase se joint par le pooler (port 5432), `db.<ref>.supabase.co` n'a qu'une adresse IPv6.
- Un heredoc Bash retire un niveau d'antislash : écrire les regex et échappements avec l'outil Write ou Edit.
- Le service worker n'est enregistré qu'en production (`npm run build && npm run preview`) : les notifications push ne se testent pas avec `npm run dev`.
