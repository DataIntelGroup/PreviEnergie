// Réglages modifiables depuis le back-office sans redéploiement (BF-31).
// La table `settings` ne stocke que les clés changées : tout le reste
// vient d'ici. Les mêmes valeurs servent à l'application et au serveur.

export type Channel = "push" | "email" | "whatsapp" | "sms";
export const CHANNELS: Channel[] = ["push", "email", "whatsapp", "sms"];

export type AlertType =
  | "niveau_j5"
  | "niveau_j2"
  | "veille"
  | "veille_rappel"
  | "releve"
  | "anomalie"
  | "bilan";

export const ALERT_TYPES: AlertType[] = [
  "niveau_j5",
  "niveau_j2",
  "veille",
  "veille_rappel",
  "releve",
  "anomalie",
  "bilan",
];

export interface Settings {
  /** Jours restants qui déclenchent les alertes de niveau. */
  thresholds: { j5: number; j2: number };
  /** Heures d'envoi, heure d'Abidjan. */
  hours: { alert: string; reminder: string; reading: string };
  /** Marge de sécurité : 0,2 = on suppose 20 % de consommation en plus. */
  safetyMargin: number;
  /** Heures sans relevé avant relance : pendant et après l'apprentissage. */
  readingReminderHours: { learning: number; standard: number };
  /** Rapport consommation récente / moyenne qui déclenche l'alerte anormale. */
  anomalyRatio: number;
  /** Prix du kWh retenu tant que l'utilisateur n'a saisi aucune recharge. */
  defaultPriceKwh: number;
  /** Types d'alerte autorisés par canal (le SMS reste réservé à l'urgent). */
  channelTypes: Record<Channel, AlertType[]>;
  /** Bilan hebdomadaire (BF-21) : jour (0 = dimanche, 1 = lundi…) et heure d'envoi. */
  weeklySummary: { weekday: number; time: string };
  /** Coûts unitaires en FCFA, pour le tableau des coûts et de la marge. */
  unitCosts: { whatsapp: number; sms: number; email: number; aiRead: number; push: number };
  /** Modèles de messages ; {nom}, {compteur}, {jours}, {date}, {heure} sont remplacés,
   *  et pour le bilan {kwh}, {evolution}, {depense}. */
  templates: Record<AlertType, string>;
}

export const DEFAULT_SETTINGS: Settings = {
  thresholds: { j5: 5, j2: 2 },
  hours: { alert: "18:00", reminder: "21:00", reading: "19:00" },
  safetyMargin: 0.2,
  readingReminderHours: { learning: 24, standard: 48 },
  anomalyRatio: 2,
  defaultPriceKwh: 110,
  channelTypes: {
    push: [...ALERT_TYPES],
    email: [...ALERT_TYPES],
    // Le bilan, non urgent, reste sur les canaux gratuits par défaut.
    whatsapp: ["niveau_j5", "niveau_j2", "veille", "veille_rappel", "anomalie", "releve"],
    sms: ["niveau_j2", "veille"],
  },
  weeklySummary: { weekday: 1, time: "08:00" },
  unitCosts: { whatsapp: 30, sms: 25, email: 0.5, aiRead: 6, push: 0 },
  templates: {
    niveau_j5:
      "{nom}, il reste environ {jours} jours de courant sur « {compteur} ». Pense à prévoir ta recharge.",
    niveau_j2:
      "{nom}, plus que {jours} jours de courant sur « {compteur} ». Recharge avant le {date}.",
    veille:
      "{nom}, ton courant sur « {compteur} » risque de couper cette nuit vers {heure}. Recharge maintenant.",
    veille_rappel:
      "Rappel : « {compteur} » risque de couper vers {heure}. Il est encore temps de recharger.",
    releve:
      "{nom}, envoie un relevé de « {compteur} » pour garder une prévision juste. Ça prend 10 secondes.",
    anomalie:
      "{nom}, la consommation de « {compteur} » a doublé par rapport à d'habitude. Vérifie tes appareils.",
    bilan:
      "{nom}, ta semaine sur « {compteur} » : {kwh} consommés ({evolution}), {depense} de recharges.",
  },
};

export const ALERT_LABELS: Record<AlertType, string> = {
  niveau_j5: "Environ 5 jours restants",
  niveau_j2: "2 jours restants",
  veille: "Veille de coupure",
  veille_rappel: "Rappel de 21 h",
  releve: "Relance de relevé",
  anomalie: "Consommation anormale",
  bilan: "Bilan de la semaine",
};

export const CHANNEL_LABELS: Record<Channel, string> = {
  push: "Notification",
  email: "Email",
  whatsapp: "WhatsApp",
  sms: "SMS",
};

type Plain = Record<string, unknown>;

function isPlain(v: unknown): v is Plain {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlain(base) || !isPlain(patch)) return (patch === undefined ? base : patch) as T;
  const out: Plain = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in base)) continue; // une clé inconnue en base est ignorée
    out[k] = deepMerge((base as Plain)[k], v);
  }
  return out as T;
}

/** Fusionne les lignes de la table `settings` (clé -> valeur) avec les défauts. */
export function resolveSettings(rows: { key: string; value: unknown }[] | null | undefined): Settings {
  let s: Settings = DEFAULT_SETTINGS;
  for (const row of rows ?? []) {
    if (!(row.key in DEFAULT_SETTINGS)) continue;
    s = deepMerge(s, { [row.key]: row.value });
  }
  return s;
}

export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (all, key: string) => vars[key] ?? all);
}
