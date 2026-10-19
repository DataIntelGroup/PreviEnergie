# PréviÉnergie

Suivi de la consommation électrique CIE et alerte avant coupure, pour les abonnés en prépayé et en postpayé en Côte d'Ivoire. Service indépendant, non affilié à la CIE.

Référence fonctionnelle : [docs/EXPRESSION_DE_BESOIN.md](docs/EXPRESSION_DE_BESOIN.md) (codes BF-01 à BF-32).

## Architecture

| Partie | Où | Rôle |
|---|---|---|
| Application (PWA) | `src/` | React 19, Vite, Tailwind 4. Mobile d'abord, installable, notifications push. |
| Back-office | `src/admin/` | Chargé à part (`/admin`), réservé aux rôles `admin` et `support`. |
| Moteur partagé | `supabase/functions/_shared/` | `prevision.ts` (consommation, moyenne pondérée, jours restants), `alertes.ts` (règles d'envoi), `reglages.ts` (valeurs par défaut). TypeScript pur, importé par l'app (`@shared/…`) **et** par les fonctions serveur. |
| Base | `supabase/migrations/` | Tables, RLS sur toutes les tables, fonctions du back-office, paiement, stockage des photos. |
| Fonctions Edge | `supabase/functions/*` | `lire-photo` (Claude vision), `prevision`, `alertes` (tâche horaire), `paiement`, `paiement-notif` (CinetPay), `test-notification`, `supprimer-compte`. |

Points clés :
- La prévision est calculée dans le navigateur pour un affichage immédiat, et sur le serveur chaque heure pour les alertes, avec le même code.
- Marge de sécurité de 20 % : on suppose 20 % de consommation en plus, l'alerte part un peu tôt.
- Une alerte par type, par cycle de recharge et par canal : garanti par une contrainte unique en base, la ligne est réservée avant l'envoi.
- Un paiement n'active une offre qu'après revérification du statut, du montant et de la devise auprès de CinetPay. La tâche horaire revérifie aussi les paiements restés en attente.
- Les canaux payants (WhatsApp, SMS) ne sont envoyés qu'aux offres qui les incluent, avec consentement enregistré.
- Un canal sans secret configuré est simplement ignoré : l'application fonctionne avec seulement les notifications push et l'email.

## Commandes

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # moteur de prévision et règles d'alerte (Vitest)
npm run test:sql     # règles d'accès et fonctions SQL sur un PostgreSQL 18 local jetable
npm run typecheck
npm run build
npm run check        # les trois vérifications d'un coup
```

`npm run test:sql` démarre un PostgreSQL local temporaire (`C:/Program Files/PostgreSQL/18/bin`, ou `PG_BIN`), y imite les rôles et le schéma `auth` de Supabase (avec ses droits par défaut trop larges), applique les migrations et lance les contrôles.

Les fonctions Edge se vérifient avec Deno : `cd supabase/functions && npx -y deno@2 check --config deno.json */index.ts`.

## Mise en ligne

Tout se pilote depuis `.env.local` (modèle : `.env.example`, jamais versionné).

1. **Clés du projet** `doxnpachkxjxxmirybwy` dans `.env.local` :
   - `VITE_SUPABASE_ANON_KEY` : Project Settings > API Keys, clé publique ;
   - `SUPABASE_DB_URL` : bouton Connect > Session pooler (port 5432), avec le mot de passe de la base ;
   - `SUPABASE_SERVICE_ROLE_KEY` et `SUPABASE_ACCESS_TOKEN` (jeton personnel : supabase.com/dashboard/account/tokens).
2. `npm run vapid` : clés des notifications push (déjà fait si `VITE_VAPID_PUBLIC_KEY` est rempli).
3. `npm run deploy -- db` : installe la base.
4. `npm run deploy -- auth` : code à 6 chiffres et modèle d'email. Avec `SMTP_*` rempli, branche aussi le service d'email (indispensable avant l'ouverture : l'email intégré de Supabase n'envoie que quelques messages par heure).
5. Renseigner les secrets disponibles (`ANTHROPIC_API_KEY`, `APP_URL`, email, CinetPay…) puis `npm run deploy -- secrets`.
6. `npm run deploy -- functions` puis `npm run deploy -- cron` (tâche horaire via pg_cron et pg_net, secret dans Vault).
7. Netlify : relier le dépôt, définir `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY` ; `netlify.toml` fait le reste. Mettre ensuite l'adresse Netlify dans `APP_URL` et `APP_ORIGINS`, puis relancer `secrets` et `auth`.
8. Se connecter une fois à l'application, puis `npm run deploy -- admin ton@email` pour devenir administrateur.

`npm run deploy -- status` résume l'état : migrations, comptes, tâche horaire et ses derniers appels.

### Prestataires (points ouverts de l'expression de besoin)

| Canal | Variables | Remarque |
|---|---|---|
| Email | `EMAIL_PROVIDER` (`resend` ou `brevo`), `EMAIL_API_KEY`, `EMAIL_FROM` | Même prestataire possible pour le SMTP du code de connexion. |
| WhatsApp | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE` | Modèle à faire valider par Meta, un paramètre `{{1}}` pour le texte de l'alerte. |
| SMS | `SMS_PROVIDER` (`orange` ou `twilio`) et ses identifiants | Réservé aux alertes urgentes (réglable dans le back-office). |
| Paiement | `CINETPAY_API_KEY`, `CINETPAY_SITE_ID` | Montants en multiples de 5 FCFA, contrôlé en base. |
| Lecture photo | `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` | Défaut `claude-opus-5-5` (environ 6 FCFA par photo). `claude-haiku-5-5` coûte environ 40 fois moins cher : à comparer sur les 50 photos réelles de la phase 0. |

## Données de test

Le seuil d'apprentissage est de 3 relevés étalés sur au moins 2 jours (6 h de tolérance) ; la prévision devient « standard » après 7 jours. Pour voir une prévision sans attendre, saisir des relevés en changeant leur date (« Relevé fait plus tôt ? »).
