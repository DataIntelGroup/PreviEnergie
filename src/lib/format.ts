// Affichage en français, heure d'Abidjan.
import { TIME_ZONE } from "@shared/temps.ts";

const nf0 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

export const fcfa = (n: number | null | undefined) => (n === null || n === undefined ? "–" : `${nf0.format(Math.round(n))} FCFA`);
export const kwh = (n: number | null | undefined) => (n === null || n === undefined ? "–" : `${nf1.format(n)} kWh`);
export const num = (n: number | null | undefined, digits = 1) =>
  n === null || n === undefined ? "–" : new Intl.NumberFormat("fr-FR", { maximumFractionDigits: digits }).format(n);
export const pct = (n: number | null | undefined) => (n === null || n === undefined ? "–" : `${nf0.format(n * 100)} %`);

const dateLong = new Intl.DateTimeFormat("fr-FR", { timeZone: TIME_ZONE, weekday: "long", day: "numeric", month: "long" });
const dateShort = new Intl.DateTimeFormat("fr-FR", { timeZone: TIME_ZONE, day: "numeric", month: "short" });
const dateTime = new Intl.DateTimeFormat("fr-FR", { timeZone: TIME_ZONE, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const time = new Intl.DateTimeFormat("fr-FR", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" });

export const fmtDateLong = (iso: string) => dateLong.format(new Date(iso));
export const fmtDate = (iso: string) => dateShort.format(new Date(iso));
export const fmtDateTime = (iso: string) => dateTime.format(new Date(iso));
export const fmtTime = (iso: string) => time.format(new Date(iso)).replace(":", " h ");

export function fmtAgo(iso: string, now = new Date()): string {
  const min = Math.round((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "hier" : `il y a ${d} jours`;
}

/** « 3 jours », « 1 jour », « moins d'un jour ». */
export function fmtDays(days: number | null): string {
  if (days === null) return "–";
  if (days < 1) return "moins d'un jour";
  const d = Math.floor(days);
  return `${d} jour${d > 1 ? "s" : ""}`;
}

/** Valeur pour un champ datetime-local, en heure d'Abidjan (UTC+0). */
export function toLocalInput(d: Date): string {
  return d.toISOString().slice(0, 16);
}

export function fromLocalInput(v: string): string {
  return new Date(`${v}:00Z`).toISOString();
}
