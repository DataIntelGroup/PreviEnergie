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
- **Reçus et factures lus sans IA payante** : `src/lib/lecture.ts` lit le document sur le téléphone (texte d'un PDF avec pdf.js, reconnaissance de caractères sur une image avec Tesseract.js, modèle français téléchargé une fois depuis jsDelivr, ou SMS collé), puis `_shared/lecture-recu.ts` en extrait les chiffres par des règles : montant, kWh, code à 20 chiffres, date, moyen de paiement, détail des taxes (contrôle énergie + taxes = montant) ; pour une facture, période, index (contrôle nouveau − ancien = consommation), total, part fixe, date limite. Les deux bibliothèques ne se chargent qu'à la première lecture. `npm run eval:lecture` mesure la lecture sur les exemples privés de `docs/prive/recus/` (jamais versionnés). La photo du compteur reste lue par `lire-photo`.
- Marge de sécurité de 20 % : on suppose 20 % de consommation en plus, l'alerte part un peu tôt.
- Une alerte par type, par cycle de recharge et par canal : garanti par une contrainte unique en base, la ligne est réservée avant l'envoi.
- Un paiement n'active une offre qu'après revérification du statut, du montant et de la devise auprès de CinetPay. La tâche horaire revérifie aussi les paiements restés en attente.
- Les canaux payants (WhatsApp, SMS) ne sont envoyés qu'aux offres qui les incluent, avec consentement enregistré.
- Un canal sans secret configuré est simplement ignoré : l'application fonctionne avec seulement les notifications push et l'email.

## Offres (grille du 2026-10-20)

Pas d'offre gratuite permanente : **14 jours d'essai** à l'inscription (réglable, clé `trialDays`), puis Essentiel 1 000, Famille / Pro 2 500 ou Entreprise 5 000 FCFA par mois, sans engagement. L'offre Découverte (300 FCFA) a existé quelques heures puis a été retirée (inactive, migration 0008). Essai terminé sans offre payée : **lecture seule**, imposée en base (`is_active_user` → `has_access`) : historique visible, plus de saisie, de lecture photo ni d'alertes. Le code d'offre `gratuit` désigne l'état « sans offre payée » (essai ou lecture seule). Prix et limites se règlent dans le back-office.

## V1 (2026-10-20)

- **Partage de compteur (BF-15)** : le propriétaire invite par email (5 personnes au plus), en « lecteur » ou « contributeur ». L'invité accepte depuis son compte ; il reçoit les alertes du compteur s'il le souhaite. Règles d'accès : `can_view_meter` / `can_edit_meter` (migration 0006).
- **Facture postpayée (BF-14)** : l'abonné enregistre sa facture CIE (photo ou PDF lu sur le téléphone, ou saisie). On en tire la période (bimestrielle en général), la part fixe (prime fixe et taxes) et le prix réel du kWh, TVA comprise ; l'estimation suivante combine le nouvel index de la facture et les relevés (`_shared/facture.ts`). Aucun barème CIE n'est codé.
- **Bilan hebdomadaire (BF-21)** : chaque lundi à 8 h par défaut (réglable), consommation des 7 derniers jours, évolution et recharges (`_shared/bilan.ts`). Désactivable par l'abonné.

## Application installable (PWA)

- **Manifeste** (`vite.config.ts`, publié en `/manifest.webmanifest`) : `id: "/app"` (identité de l'app installée, à ne jamais changer), icônes 192 et 512 (plus une version « maskable » pour Android), fond crème `#fffaf5` pour l'écran de démarrage, orange `#ea580c` pour la barre d'état, raccourcis Relevé et Recharge, `related_applications` pour que Chrome sache dire si l'app est déjà installée. `VITE_SITE_URL` change l'adresse publique (défaut : https://previenergie.vercel.app).
- **`InstallAppButton`** (`src/components/InstallAppButton.tsx`) ne montre « Installer l'application » que si le navigateur a fourni une vraie invite native (`beforeinstallprompt` : Chrome, Edge, Samsung Internet, Opera). Partout ailleurs, il propose « Comment installer » et ouvre le guide du navigateur détecté (`src/lib/install-detect.ts`, testé dans `tests/install.test.ts`) : Safari et autres navigateurs sur iPhone, navigateurs intégrés à WhatsApp, Facebook ou Instagram (ouvrir dans le vrai navigateur), Android, Windows, Mac. Déjà installée : un badge. Les navigateurs qui ne savent pas installer (Firefox sur ordinateur, Safari 16) sont signalés, avec le lien à copier.
- **Service worker** (`src/sw.ts`) : seulement les fichiers de l'application de la version en cours, et les notifications. Aucune donnée n'est mise en cache : Supabase passe toujours par le réseau. Une nouvelle version s'installe en arrière-plan et s'applique quand on quitte l'app, sauf en pleine saisie (formulaire ouvert, relevé, recharge, connexion). Une app restée ouverte vérifie chaque heure et à chaque retour. Un onglet qui demanderait un fichier d'une ancienne version se recharge une fois (`vite:preloadError`) ; Vercel renvoie une vraie 404 pour un fichier `/assets/` disparu au lieu de la page HTML.
- Le service worker n'est actif qu'en production : `npm run prod` construit puis sert le site sur http://localhost:4173 pour le tester (marche aussi dans Windows PowerShell, qui refuse `&&`).

Critères d'acceptation, à vérifier sur appareil réel avant d'annoncer un système comme compatible :

| Appareil | Attendu |
|---|---|
| Android, Chrome | bouton « Installer l'application » → invite native → icône PréviÉnergie, s'ouvre sans barre d'adresse sur `/app` |
| Android, Samsung Internet / Firefox | invite native ou guide du menu, selon le navigateur |
| iPhone, Safari (iOS 16.4+) | « Comment installer » → guide Partager › Sur l'écran d'accueil ; une fois installée, notifications activables dans Alertes |
| iPhone, WhatsApp / Instagram | guide « ouvrir dans le navigateur » et lien à copier |
| Windows, Chrome ou Edge | invite native, app dans le menu Démarrer, fenêtre à part |
| Mac, Safari 17+ / Chrome | guide Fichier › Ajouter au Dock, ou invite native de Chrome |
| Après installation | la page d'accueil affiche le badge « installée » (Chrome), jamais un bouton Installer |
| Nouvelle mise en ligne | l'app installée prend la nouvelle version au retour suivant, sans perdre une saisie en cours |

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
7. Netlify : mettre `NETLIFY_AUTH_TOKEN` (User settings > Applications > Personal access tokens) dans `.env.local`, puis `npm run deploy -- netlify`. Le script crée le site au premier passage, construit l'application, l'envoie, et met à jour `APP_URL`, `APP_ORIGINS` et l'authentification Supabase avec l'adresse publique. Les règles de redirection et d'en-têtes sont dans `public/_redirects` et `public/_headers`.
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

## Comptes de test

`npm run comptes:test` crée ou reprend `testeur@previenergie.test` (utilisateur) et `equipe@previenergie.test` (administrateur), profils complétés, et affiche pour chacun un code de connexion valable 10 minutes, sans envoyer d'email. Sur `/connexion` : saisir l'email, puis « J'ai déjà un code ».

Sans service SMTP, l'email intégré de Supabase n'écrit qu'aux membres de l'organisation Supabase, quelques fois par heure, et contient un lien au lieu du code (le plan gratuit interdit de changer le modèle d'email sans SMTP). L'application accepte les deux.

Le poste de travail est derrière un proxy qui bloque les ports PostgreSQL : `npm run deploy` bascule alors sur l'API de gestion Supabase (HTTPS) avec `SUPABASE_ACCESS_TOKEN`.

## Données de test

Le seuil d'apprentissage est de 3 relevés étalés sur au moins 2 jours (6 h de tolérance) ; la prévision devient « standard » après 7 jours. Pour voir une prévision sans attendre, saisir des relevés en changeant leur date (« Relevé fait plus tôt ? »).
