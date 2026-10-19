# Expression de besoin — PréviÉnergie

> Version 1.0 du 19 octobre 2026. Data Intelligence Group. Référence pour le développement : chaque besoin porte un code BF-xx et une priorité (MVP, V1, V2).

Application de suivi de la consommation électrique CIE et d'alerte avant coupure, pour les abonnés en prépayé et en postpayé en Côte d'Ivoire.

| **Élément**       | **Détail**                                                                            |
|-------------------|---------------------------------------------------------------------------------------|
| Porteur du projet | Claude-Daniel Akora, Data Intelligence Group (DIG)                                    |
| Pays              | Côte d'Ivoire                                                                         |
| Date              | 19 octobre 2026                                                                       |
| Version           | 1.0                                                                                   |
| Statut            | MVP développé, mise en ligne en préparation                                           |
| Documents liés    | Cahier des charges PréviÉnergie (18 octobre 2026), dépôt du code, README et CLAUDE.md |

## 1. Contexte et problématique

La majorité des abonnés de la CIE sont en compteur prépayé : la CIE annonçait 58 % de clients prépayés en 2022. Beaucoup subissent des coupures évitables, souvent la nuit, parce qu'ils ne suivent ni le crédit restant ni leur consommation moyenne.

| **Problème constaté**                                         | **Conséquence pour l'abonné**                                                     |
|---------------------------------------------------------------|-----------------------------------------------------------------------------------|
| Solde du compteur non suivi                                   | Coupure surprise, souvent vers 2 h du matin, quand il est impossible de recharger |
| Consommation moyenne inconnue                                 | Impossible de savoir combien recharger, ni quand                                  |
| Écart entre montant payé et énergie reçue (taxes, redevances) | Sentiment que le courant « finit vite »                                           |
| Recharges payées par Wave, Orange Money, MTN MoMo, Moov Money | Historique éclaté, codes de recharge perdus                                       |
| Postpayé : facture découverte à réception                     | Hausses inexpliquées, aucune visibilité avant la facture                          |
| Logements partagés, bailleurs, diaspora                       | Partage des coûts difficile, aucun suivi à distance                               |

La CIE propose une agence en ligne et des compteurs intelligents, mais aucune alerte proactive avant la coupure sur les canaux que les gens lisent vraiment. PréviÉnergie comble ce manque, sans dépendre d'une API de la CIE.

## 2. Objectifs du projet

Objectif principal : prévenir chaque abonné avant la coupure, à partir des relevés qu'il remonte en quelques secondes. Promesse : « Plus jamais de coupure surprise. »

- Estimer la consommation moyenne journalière après 3 à 7 jours de relevés.

- Alerter 5 jours, 2 jours et la veille de l'épuisement prévu du crédit, à 18 h, quand on peut encore recharger.

- Centraliser l'historique des recharges, des dépenses et de la consommation, codes de recharge compris.

- Donner à l'administrateur une vue en temps réel des inscriptions, des revenus, des coûts et de l'activité.

- Rester rentable dès le départ : offre gratuite sur des canaux gratuits, canaux payants réservés aux abonnés payants.

## 3. Utilisateurs cibles

| **Profil**            | **Situation**                                 | **Besoin principal**                        | **Phase** |
|-----------------------|-----------------------------------------------|---------------------------------------------|-----------|
| Locataire en prépayé  | Recharge par petits montants                  | Être prévenu avant la coupure de nuit       | MVP       |
| Chef de ménage        | Famille, climatisation, réfrigérateur         | Connaître la moyenne pour budgéter          | MVP       |
| Commerçant, PME       | Une coupure fait perdre du chiffre d'affaires | Alerte fiable sur plusieurs compteurs       | MVP       |
| Abonné postpayé       | Factures imprévisibles                        | Estimer la facture à venir                  | V1        |
| Membre de la diaspora | Paie le courant de la famille                 | Suivre un compteur à distance               | V1        |
| Bailleur              | Plusieurs logements                           | Vue d'ensemble, partage avec les locataires | V2        |
| Administrateur DIG    | Pilote le service                             | Tableaux de bord, réglages, support         | MVP       |

## 4. Besoins fonctionnels

Chaque besoin porte une référence et une priorité : MVP (première mise en ligne), V1 ou V2.

### 4.1 Accès et compte

| **Réf.**  | **Besoin**                                                                                                                                                           | **Priorité** |
|-----------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------|
| **BF-01** | Connexion par email uniquement, avec un code à 6 chiffres, sans mot de passe. Le compte est créé à la première connexion.                                            | MVP          |
| **BF-02** | Profil obligatoire avant tout accès à l'application : prénom, nom et numéro de téléphone (10 chiffres commençant par 01, 05, 07, 21, 25 ou 27). Commune facultative. | MVP          |
| **BF-03** | Modification du profil et suppression du compte par l'utilisateur, photos comprises.                                                                                 | MVP          |

### 4.2 Compteurs, relevés et recharges

| **Réf.**  | **Besoin**                                                                                                                                 | **Priorité** |
|-----------|--------------------------------------------------------------------------------------------------------------------------------------------|--------------|
| **BF-04** | Ajout de compteurs : nom (Maison, Boutique…), type prépayé ou postpayé, numéro. Nombre limité selon l'offre.                               | MVP          |
| **BF-05** | Relevé par photo de l'écran du compteur, lue automatiquement par l'IA, avec confirmation ou correction. Saisie manuelle toujours possible. | MVP          |
| **BF-06** | Contrôles de cohérence : solde en hausse sans recharge, chute anormale, index postpayé en baisse.                                          | MVP          |
| **BF-07** | Enregistrement des recharges par photo du reçu ou du SMS, ou saisie : kWh, montant, code, moyen de paiement, date.                         | MVP          |
| **BF-08** | Transfert du SMS de recharge au numéro WhatsApp de PréviÉnergie pour lecture automatique.                                                  | V1           |

### 4.3 Prévision et tableau de bord utilisateur

| **Réf.**  | **Besoin**                                                                                                                                               | **Priorité** |
|-----------|----------------------------------------------------------------------------------------------------------------------------------------------------------|--------------|
| **BF-09** | Calcul de la consommation entre deux relevés (recharges déduites) et d'une moyenne pondérée qui donne plus de poids aux jours récents.                   | MVP          |
| **BF-10** | Phase d'apprentissage : première prévision après 3 relevés étalés sur au moins 2 jours, prévision standard après 7 jours.                                | MVP          |
| **BF-11** | Accueil : jauge des jours de courant restants (vert, ambre, rouge), date et heure probables de coupure, moyenne par jour, coût par jour, dernier relevé. | MVP          |
| **BF-12** | Historique : consommation par jour sur 14 ou 30 jours, dépenses du mois, liste des relevés et recharges avec suppression.                                | MVP          |
| **BF-13** | Question « As-tu été coupé ? » après la date prévue, pour mesurer les coupures évitées.                                                                  | MVP          |
| **BF-14** | Estimation de la prochaine facture pour les compteurs postpayés.                                                                                         | V1           |
| **BF-15** | Partage d'un compteur avec un proche (diaspora, colocataire).                                                                                            | V1           |

### 4.4 Alertes

| **Réf.**  | **Besoin**                                                                                                                                     | **Priorité** |
|-----------|------------------------------------------------------------------------------------------------------------------------------------------------|--------------|
| **BF-16** | Alertes de niveau à 18 h : environ 5 jours restants, 2 jours restants, veille de coupure (avec rappel à 21 h).                                 | MVP          |
| **BF-17** | Relance de relevé à 19 h après 24 h sans relevé pendant l'apprentissage, 48 h ensuite.                                                         | MVP          |
| **BF-18** | Alerte de consommation anormale quand la consommation double par rapport à la moyenne.                                                         | MVP          |
| **BF-19** | Canaux : notification push (gratuite), WhatsApp, SMS (alertes urgentes seulement) et email, selon l'offre et les préférences de l'utilisateur. | MVP          |
| **BF-20** | Heures calmes réglables (21 h 30 à 7 h par défaut) ; une seule alerte de chaque type par cycle de recharge.                                    | MVP          |
| **BF-21** | Bilan hebdomadaire de consommation et de dépenses.                                                                                             | V1           |

### 4.5 Offres et paiement

| **Réf.**  | **Besoin**                                                                                                                                                            | **Priorité** |
|-----------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------|
| **BF-22** | Offres mensuelles sans engagement, payées par Wave, Orange Money, MTN MoMo ou Moov Money via CinetPay. Statut toujours revérifié auprès de CinetPay avant activation. | MVP          |
| **BF-23** | Expiration automatique de l'offre à son terme, retour à l'offre gratuite.                                                                                             | MVP          |
| **BF-24** | Recharge du compteur directement depuis l'alerte, avec commission.                                                                                                    | V2           |
| **BF-25** | Espace bailleur multi-compteurs et répartition par locataire.                                                                                                         | V2           |

### 4.6 Back-office

| **Réf.**  | **Besoin**                                                                                                                        | **Priorité** |
|-----------|-----------------------------------------------------------------------------------------------------------------------------------|--------------|
| **BF-26** | Tableau des inscriptions : total, nouveaux, comptes actifs, répartition par commune, source, offre et type de compteur.           | MVP          |
| **BF-27** | Tableau financier : revenu mensuel récurrent, encaissements, abonnés payants, conversion, moyens de paiement, derniers paiements. | MVP          |
| **BF-28** | Tableau des coûts et de la marge : coûts WhatsApp, SMS, email et lecture IA, coût par utilisateur actif, marge par offre.         | MVP          |
| **BF-29** | Tableau d'activité : relevés, taux de lecture des photos, rétention, alertes par canal et par type, coupures évitées.             | MVP          |
| **BF-30** | Gestion des utilisateurs : recherche par nom, prénom, téléphone ou email ; changement d'offre, de rôle, suspension.               | MVP          |
| **BF-31** | Réglages sans redéploiement : seuils, heures d'envoi, marge de sécurité, coûts unitaires, prix des offres, modèles de messages.   | MVP          |
| **BF-32** | Rôles administrateur et support (lecture seule), journal d'audit des actions.                                                     | MVP          |

## 5. Besoins non fonctionnels

| **Critère**           | **Exigence**                                                                                                                                               |
|-----------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Plateformes           | Application web installable (PWA) sur Android depuis Chrome et sur iPhone depuis Safari. Notifications push sur iPhone à partir d'iOS 16.4, app installée. |
| Ergonomie             | Un relevé en moins de 10 secondes. Mobile d'abord, gros chiffres lisibles, français, tutoiement.                                                           |
| Performance           | Photos compressées à moins de 500 Ko avant envoi. Back-office et graphiques chargés à part pour alléger l'app.                                             |
| Sécurité              | Règles d'accès par ligne (RLS) sur toutes les tables, photos privées, clé de service jamais dans l'application, rôles séparés.                             |
| Données personnelles  | Déclaration du traitement à l'ARTCI, consentement pour WhatsApp et SMS, export et suppression du compte.                                                   |
| Fiabilité des alertes | Marge de sécurité de 20 % : l'alerte part un peu tôt plutôt qu'un peu tard. Recalcul horaire et après chaque relevé.                                       |
| Fuseau horaire        | Africa/Abidjan (UTC+0) pour toutes les heures d'envoi et dates affichées.                                                                                  |
| Identité              | Orange et blanc. Mention visible « Service indépendant, non affilié à la CIE ».                                                                            |
| Qualité               | Tests automatiques du moteur de prévision, des alertes et des règles d'accès avant chaque livraison.                                                       |

## 6. Choix techniques

| **Brique**                 | **Choix**                                                                               |
|----------------------------|-----------------------------------------------------------------------------------------|
| Application                | React, Vite, TypeScript, Tailwind CSS, PWA avec service worker                          |
| Base de données et comptes | Supabase : Postgres, authentification par email, stockage des photos, fonctions serveur |
| Projet Supabase            | doxnpachkxjxxmirybwy (plan gratuit, compte dédié)                                       |
| Lecture des photos         | API Claude avec vision, réponse structurée                                              |
| Notifications push         | Web Push (clés VAPID)                                                                   |
| WhatsApp                   | API WhatsApp Business de Meta, modèles validés                                          |
| SMS                        | Orange SMS API ou Twilio                                                                |
| Email                      | Resend ou Brevo                                                                         |
| Paiement                   | CinetPay (mobile money)                                                                 |
| Hébergement                | Netlify pour l'application, Supabase pour le serveur                                    |
| Développement              | Poursuivi avec Claude Code, sur le poste local (dossier Documents\Index)                |

## 7. Contraintes

- Aucune API de la CIE : toutes les données viennent de l'utilisateur (photos, SMS, saisie).

- Budget de départ nul : plan gratuit Supabase (deux projets actifs maximum par compte, mise en pause après une semaine sans activité). Les projets existants Beautika et Klyo ne sont pas touchés.

- Envoi d'emails intégré à Supabase très limité : un service d'email (SMTP) est nécessaire avant l'ouverture au public.

- Messages WhatsApp envoyés par l'entreprise : modèles à faire valider par Meta, coût par message.

- CinetPay : montants en multiples de 5 FCFA.

- Marque CIE : ni logo ni charte de la CIE, mention d'indépendance obligatoire.

## 8. Modèle économique

Freemium : les alertes essentielles sont gratuites, les canaux payants et les fonctions avancées passent par un abonnement mensuel. Prix provisoires, modifiables dans le back-office.

| **Offre**     | **Contenu**                                                                     | **Prix mensuel** |
|---------------|---------------------------------------------------------------------------------|------------------|
| Gratuit       | 1 compteur, prévision, alertes par notification et email, 30 jours d'historique | 0 FCFA           |
| Essentiel     | 2 compteurs, alertes WhatsApp et SMS urgents, historique illimité               | 1 000 FCFA       |
| Famille / Pro | Jusqu'à 5 compteurs, mêmes canaux, historique illimité                          | 2 500 FCFA       |

Revenus complémentaires prévus en V2 : commission sur les recharges payées depuis l'alerte, partenariats (électriciens, solaire, appareils économes).

## 9. État d'avancement au 19 octobre 2026

| **Élément**                                                                                                                  | **Statut**                 |
|------------------------------------------------------------------------------------------------------------------------------|----------------------------|
| Cahier des charges                                                                                                           | Fait                       |
| Application utilisateur (connexion, profil obligatoire, compteurs, relevés, recharges, accueil, historique, alertes, offres) | Fait                       |
| Back-office (4 tableaux de bord, utilisateurs, réglages, journal)                                                            | Fait                       |
| Base de données, règles d'accès, fonctions du back-office                                                                    | Fait, 31 contrôles validés |
| Fonctions serveur (lecture photo, prévision, alertes, paiement, suppression de compte)                                       | Fait, vérifiées            |
| Moteur de prévision et règles d'alerte                                                                                       | Fait, 40 tests validés     |
| Démo en ligne (données fictives)                                                                                             | Fait                       |
| Projet copié sur le poste local pour Claude Code                                                                             | Fait                       |
| Installation de la base dans le projet Supabase                                                                              | À faire                    |
| Modèle d'email avec code à 6 chiffres et service SMTP                                                                        | À faire                    |
| Déploiement des fonctions serveur, secrets, tâches planifiées                                                                | À faire                    |
| Mise en ligne sur Netlify                                                                                                    | À faire                    |
| Comptes WhatsApp Business, SMS, CinetPay                                                                                     | À faire                    |
| Désignation du premier administrateur                                                                                        | À faire                    |

## 10. Phases du projet

| **Phase**                                 | **Contenu**                                                                                                      | **Critère de passage**                                                                          |
|-------------------------------------------|------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------|
| Phase 0 : validation (environ 2 semaines) | 30 à 50 testeurs en prépayé ; au moins 50 photos réelles d'écrans et de reçus pour tester la lecture automatique | Au moins 90 % des photos nettes lues correctement ; testeurs prêts à envoyer un relevé par jour |
| Phase 1 : MVP                             | Mise en ligne de l'application, des alertes et du paiement                                                       | 60 % des testeurs actifs à 30 jours, coupures évitées confirmées                                |
| Phase 2 : V1                              | Postpayé, partage de compteur, bilan hebdomadaire, SMS par WhatsApp, Play Store                                  | Rétention et conversion vers les offres payantes                                                |
| Phase 3 : V2                              | Recharge depuis l'alerte, espace bailleur, partenariats                                                          | Revenus complémentaires                                                                         |

## 11. Critères d'acceptation du MVP

1.  Un nouvel utilisateur se connecte par email avec un code à 6 chiffres.

2.  Il ne peut accéder à aucune page tant que son prénom, son nom et son numéro ne sont pas renseignés.

3.  Il ajoute un compteur, envoie une photo, et la valeur lue lui est proposée pour confirmation.

4.  Après 3 relevés sur au moins 2 jours, l'accueil affiche les jours restants et la date de coupure.

5.  Une alerte J-5, J-2 ou veille part à 18 h sur les canaux autorisés par son offre, une seule fois par cycle de recharge.

6.  Un paiement mobile money accepté active l'offre pour 30 jours ; un paiement refusé ne l'active pas.

7.  Un utilisateur ne voit jamais les données d'un autre ; seul un administrateur modifie offres, rôles et réglages.

8.  L'administrateur voit les inscriptions, les revenus, les coûts et l'activité sur 7, 30 ou 90 jours.

## 12. Risques et parades

| **Risque**                                          | **Parade**                                                                                    |
|-----------------------------------------------------|-----------------------------------------------------------------------------------------------|
| Les utilisateurs cessent d'envoyer leurs relevés    | Relance quotidienne, relevé en un geste, prévision utile même avec un relevé tous les 2 jours |
| Lecture photo erronée                               | Confirmation systématique, guide photo, contrôles de cohérence                                |
| Coûts WhatsApp et SMS supérieurs aux revenus        | Canaux payants réservés aux offres payantes, suivi de marge dans le back-office               |
| Notifications limitées sur iPhone                   | Guide d'installation sur l'écran d'accueil, WhatsApp en secours                               |
| Projet Supabase gratuit mis en pause par inactivité | Tâches planifiées actives chaque heure ; passage au plan payant dès les premiers revenus      |
| La CIE lance ses propres alertes                    | Multicanal, tous types de compteurs, simplicité, offre bailleurs                              |
| Confusion avec la marque CIE                        | Mention d'indépendance, identité visuelle distincte                                           |

## 13. Décisions et points ouverts

### Décisions prises

- Nom du produit : PréviÉnergie. Couleurs : orange et blanc.

- Connexion par email uniquement, pas de connexion par SMS.

- Prénom, nom et numéro de téléphone obligatoires avant d'accéder à l'application.

- Hébergement de départ sur le plan gratuit, dans un compte Supabase dédié, sans toucher à Beautika ni à Klyo.

- Suite du développement avec Claude Code sur le poste local.

### Points à trancher

- Prix définitifs des offres Essentiel et Famille / Pro.

- Service d'email (Resend ou Brevo) et adresse d'expédition.

- Prestataires WhatsApp Business et SMS.

- Ouverture du compte marchand CinetPay.

- Déclaration du traitement auprès de l'ARTCI.

- Nom de domaine (previenergie.ci ou previenergie.com) et dépôt de la marque à l'OAPI.
