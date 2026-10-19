// Heure d'Abidjan (UTC+0, sans heure d'été). Tout calcul d'heure d'envoi
// passe par ici, pour ne jamais dépendre du fuseau de la machine qui exécute.

export const TIME_ZONE = "Africa/Abidjan";
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  /** Date locale au format AAAA-MM-JJ, sert de clé « une fois par jour ». */
  date: string;
  /** Minutes écoulées depuis minuit, pour comparer aux heures calmes. */
  minutes: number;
}

const formatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function localParts(date: Date): LocalParts {
  const parts: Record<string, string> = {};
  for (const p of formatter.formatToParts(date)) parts[p.type] = p.value;
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  return {
    year,
    month,
    day,
    hour,
    minute,
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: hour * 60 + minute,
  };
}

/** « 21:30 » -> 1290. Lève une erreur si le format est faux. */
export function parseHHMM(value: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!m) throw new Error(`Heure invalide : ${value}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Vrai si `minutes` tombe dans la plage calme [start, end[.
 * La plage peut passer minuit (21:30 -> 07:00).
 */
export function inQuietHours(minutes: number, start: string, end: string): boolean {
  const s = parseHHMM(start);
  const e = parseHHMM(end);
  if (s === e) return false;
  return s < e ? minutes >= s && minutes < e : minutes >= s || minutes < e;
}

/** Instant UTC correspondant à AAAA-MM-JJ hh:mm à Abidjan. */
export function abidjanInstant(date: string, hhmm: string): Date {
  // Abidjan est à UTC+0 toute l'année : l'heure locale est l'heure UTC.
  return new Date(`${date}T${hhmm}:00Z`);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
