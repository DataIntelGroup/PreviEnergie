// Groupes de clients pour les relances de l'équipe (back-office) : qui reçoit
// un message, et le texte proposé par défaut. Règles pures, partagées entre
// le back-office (aperçu) et la fonction admin-clients (envoi), testées dans
// tests/segments.test.ts.
import { accessStatus, type AccessProfile } from "./acces.ts";
import { DAY_MS } from "./temps.ts";

export type Segment = "tous" | "abonnes" | "essai" | "essai_fin" | "expire" | "renouvellement" | "inactifs";

export interface SegmentProfile extends AccessProfile {
  role: string;
  suspended: boolean;
  /** Dernier relevé, tous compteurs confondus. */
  last_reading_at: string | null;
}

/** Liens que l'équipe peut mettre dans un message (chemins de src/lib/routes.ts). */
export const MESSAGE_LINKS = {
  "/app": "Accueil",
  "/app/releve": "Nouveau relevé",
  "/app/recharge": "Nouvelle recharge",
  "/app/offres": "Offres",
  "/app/alertes": "Réglage des alertes",
} as const;
export type MessageLink = keyof typeof MESSAGE_LINKS;

export interface SegmentInfo {
  label: string;
  hint: string;
  title: string;
  body: string;
  link: MessageLink;
}

export const SEGMENTS: Record<Segment, SegmentInfo> = {
  tous: {
    label: "Tous les clients",
    hint: "Essai en cours, abonnés et lecture seule.",
    title: "Nouveauté PréviÉnergie",
    body: "Bonjour {prenom}, ",
    link: "/app",
  },
  abonnes: {
    label: "Abonnés payants",
    hint: "Offre payante en cours.",
    title: "Merci de ta confiance",
    body: "Bonjour {prenom}, merci d'utiliser PréviÉnergie. ",
    link: "/app",
  },
  essai: {
    label: "En essai gratuit",
    hint: "Les 14 jours d'essai ne sont pas finis.",
    title: "Profite de ton essai",
    body: "Bonjour {prenom}, fais un relevé chaque jour : plus tu relèves, plus la prévision de coupure est juste.",
    link: "/app/releve",
  },
  essai_fin: {
    label: "Essai qui se termine",
    hint: "Fin de l'essai dans 3 jours ou moins.",
    title: "Ton essai se termine bientôt",
    body: "Bonjour {prenom}, ton essai gratuit se termine dans quelques jours. Garde tes alertes avant coupure à partir de 1 000 FCFA par mois.",
    link: "/app/offres",
  },
  expire: {
    label: "Lecture seule",
    hint: "Essai ou offre terminés, sans renouvellement.",
    title: "Tes alertes sont en pause",
    body: "Bonjour {prenom}, ton compte est en lecture seule : plus d'alerte avant coupure. Reprends dès 1 000 FCFA par mois, ton historique t'attend.",
    link: "/app/offres",
  },
  renouvellement: {
    label: "Offre qui expire",
    hint: "Offre payante qui se termine dans 7 jours ou moins.",
    title: "Pense à renouveler",
    body: "Bonjour {prenom}, ton offre PréviÉnergie se termine bientôt. Renouvelle-la pour ne pas perdre tes alertes.",
    link: "/app/offres",
  },
  inactifs: {
    label: "Sans relevé depuis 3 jours",
    hint: "Accès en cours, mais aucun relevé depuis 3 jours ou plus.",
    title: "Un relevé, 10 secondes",
    body: "Bonjour {prenom}, ton dernier relevé date de quelques jours : ta prévision de coupure devient moins sûre. Une photo de ton compteur suffit.",
    link: "/app/releve",
  },
};

/** Le client fait-il partie du groupe ? Équipe et comptes suspendus : jamais. */
export function inSegment(p: SegmentProfile, segment: Segment, now: Date): boolean {
  if (p.role !== "user" || p.suspended) return false;
  const status = accessStatus(p, now);
  const t = now.getTime();
  switch (segment) {
    case "tous":
      return true;
    case "abonnes":
      return status === "paid";
    case "essai":
      return status === "trial";
    case "essai_fin":
      return status === "trial" && new Date(p.trial_ends_at).getTime() - t <= 3 * DAY_MS;
    case "expire":
      return status === "expired";
    case "renouvellement":
      return status === "paid" && !!p.plan_expires_at && new Date(p.plan_expires_at).getTime() - t <= 7 * DAY_MS;
    case "inactifs":
      return status !== "expired" && (!p.last_reading_at || t - new Date(p.last_reading_at).getTime() >= 3 * DAY_MS);
  }
}

/** Remplace {prenom} par le prénom du client (ou rien). */
export function personalize(text: string, firstName: string | null): string {
  return text.replaceAll("{prenom}", (firstName ?? "").trim()).replace(/Bonjour\s+,/g, "Bonjour,").replace(/\s{2,}/g, " ").trim();
}

export const MESSAGE_LIMITS = { title: 60, body: 300 };
