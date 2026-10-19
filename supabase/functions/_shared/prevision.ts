// Moteur de prévision (BF-06, BF-09, BF-10, BF-11, BF-18).
// TypeScript pur, sans dépendance : le même fichier tourne dans le
// navigateur (affichage immédiat) et dans les fonctions serveur (alertes).

import { DAY_MS, HOUR_MS } from "./temps.ts";

export type MeterKind = "prepaid" | "postpaid";

export interface Reading {
  id: string;
  /** Instant ISO du relevé. */
  takenAt: string;
  /** Prépayé : kWh restants affichés. Postpayé : index cumulé en kWh. */
  value: number;
}

export interface Recharge {
  id: string;
  purchasedAt: string;
  kwh: number;
  amountFcfa: number;
}

export type ForecastStatus = "insufficient" | "preliminary" | "standard";

export interface Segment {
  from: string;
  to: string;
  days: number;
  kwh: number;
  /** kWh par jour sur ce segment. */
  rate: number;
}

export interface Forecast {
  status: ForecastStatus;
  /** Relevés et jours encore nécessaires pour sortir de l'apprentissage. */
  learning: { readings: number; spanDays: number; readingsNeeded: number; daysNeeded: number };
  /** Moyenne pondérée en kWh par jour, null tant qu'elle n'est pas calculable. */
  avgKwhDay: number | null;
  /** Prix moyen payé par kWh (recharges des 90 derniers jours, sinon défaut). */
  priceKwh: number;
  costPerDay: number | null;
  /** Prépayé : solde estimé maintenant. */
  balanceKwh: number | null;
  /** Jours restants avec la marge de sécurité (affichage et alertes). */
  daysRemaining: number | null;
  /** Instant estimé de coupure, marge comprise. */
  cutoffAt: string | null;
  /** Postpayé : estimation sur 30 jours. */
  monthlyEstimateFcfa: number | null;
  lastReading: Reading | null;
  /** Identifiant du cycle de recharge en cours : dernière recharge, ou « initial ». */
  cycleKey: string;
  /** Consommation récente au moins `anomalyRatio` fois la moyenne. */
  anomaly: boolean;
  segments: Segment[];
}

export interface ForecastOptions {
  now: Date;
  safetyMargin: number;
  defaultPriceKwh: number;
  anomalyRatio: number;
}

// Réglages internes du calcul, documentés ici plutôt qu'exposés à l'admin.
export const LEARNING_MIN_READINGS = 3;
/** « Au moins 2 jours » avec 6 h de tolérance : 8 h lundi, 8 h mardi, 7 h mercredi passe. */
export const PRELIMINARY_SPAN_HOURS = 2 * 24 - 6;
export const STANDARD_SPAN_HOURS = 7 * 24 - 6;
/** Deux relevés plus rapprochés ne donnent pas un débit fiable : on les regroupe. */
export const MIN_SEGMENT_HOURS = 4;
/** Demi-vie de la pondération : un jour vieux d'une semaine compte moitié moins. */
export const HALF_LIFE_DAYS = 7;
/** Fenêtre de calcul de la moyenne. */
export const WINDOW_DAYS = 30;
/** Un segment récent doit couvrir au moins 12 h pour juger d'une anomalie. */
export const ANOMALY_MIN_HOURS = 12;
/** Tolérance de lecture, en kWh, avant de signaler un solde en hausse. */
export const READING_TOLERANCE_KWH = 0.5;

const t = (iso: string) => new Date(iso).getTime();

export function sortReadings(readings: Reading[]): Reading[] {
  return [...readings].sort((a, b) => t(a.takenAt) - t(b.takenAt));
}

/** kWh rechargés dans l'intervalle ]from, to]. */
export function rechargedBetween(recharges: Recharge[], from: number, to: number): number {
  let sum = 0;
  for (const r of recharges) {
    const at = t(r.purchasedAt);
    if (at > from && at <= to) sum += r.kwh;
  }
  return sum;
}

/** Consommation entre deux relevés, recharges déduites (BF-09). */
export function consumptionBetween(
  kind: MeterKind,
  prev: Reading,
  cur: Reading,
  recharges: Recharge[],
): number {
  if (kind === "postpaid") return cur.value - prev.value;
  return prev.value + rechargedBetween(recharges, t(prev.takenAt), t(cur.takenAt)) - cur.value;
}

/**
 * Découpe l'historique en segments d'au moins MIN_SEGMENT_HOURS.
 * Un segment à consommation négative (lecture fausse, recharge oubliée)
 * est écarté : il fausserait la moyenne.
 */
export function buildSegments(kind: MeterKind, readings: Reading[], recharges: Recharge[]): Segment[] {
  const sorted = sortReadings(readings);
  const segments: Segment[] = [];
  let anchor = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const hours = (t(cur.takenAt) - t(anchor.takenAt)) / HOUR_MS;
    if (hours < MIN_SEGMENT_HOURS) continue;
    const kwh = consumptionBetween(kind, anchor, cur, recharges);
    const days = hours / 24;
    if (kwh >= 0) segments.push({ from: anchor.takenAt, to: cur.takenAt, days, kwh, rate: kwh / days });
    anchor = cur;
  }
  return segments;
}

/** Moyenne pondérée : poids = durée × 0,5^(âge / demi-vie). */
export function weightedAverage(segments: Segment[], now: Date): number | null {
  let num = 0;
  let den = 0;
  const nowMs = now.getTime();
  for (const s of segments) {
    const mid = (t(s.from) + t(s.to)) / 2;
    const ageDays = Math.max(0, (nowMs - mid) / DAY_MS);
    if (ageDays > WINDOW_DAYS) continue;
    const w = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
    num += s.kwh * w;
    den += s.days * w;
  }
  return den > 0 ? num / den : null;
}

export function averagePrice(recharges: Recharge[], now: Date, fallback: number): number {
  const since = now.getTime() - 90 * DAY_MS;
  let kwh = 0;
  let fcfa = 0;
  for (const r of recharges) {
    if (t(r.purchasedAt) < since || r.kwh <= 0 || r.amountFcfa <= 0) continue;
    kwh += r.kwh;
    fcfa += r.amountFcfa;
  }
  return kwh > 0 ? fcfa / kwh : fallback;
}

export function currentCycleKey(recharges: Recharge[]): string {
  let latest: Recharge | null = null;
  for (const r of recharges) if (!latest || t(r.purchasedAt) > t(latest.purchasedAt)) latest = r;
  return latest ? latest.id : "initial";
}

export function learningState(readings: Reading[]) {
  const sorted = sortReadings(readings);
  const n = sorted.length;
  const spanHours = n >= 2 ? (t(sorted[n - 1].takenAt) - t(sorted[0].takenAt)) / HOUR_MS : 0;
  let status: ForecastStatus = "insufficient";
  if (n >= LEARNING_MIN_READINGS && spanHours >= PRELIMINARY_SPAN_HOURS) {
    status = spanHours >= STANDARD_SPAN_HOURS ? "standard" : "preliminary";
  }
  return {
    status,
    readings: n,
    spanDays: spanHours / 24,
    readingsNeeded: Math.max(0, LEARNING_MIN_READINGS - n),
    daysNeeded: Math.max(0, Math.ceil((PRELIMINARY_SPAN_HOURS - spanHours) / 24)),
  };
}

export function computeForecast(
  kind: MeterKind,
  readings: Reading[],
  recharges: Recharge[],
  opts: ForecastOptions,
): Forecast {
  const sorted = sortReadings(readings).filter((r) => t(r.takenAt) <= opts.now.getTime());
  const learning = learningState(sorted);
  const segments = buildSegments(kind, sorted, recharges);
  const lastReading = sorted.length ? sorted[sorted.length - 1] : null;
  const priceKwh = averagePrice(recharges, opts.now, opts.defaultPriceKwh);
  const cycleKey = currentCycleKey(recharges);

  const base: Forecast = {
    status: learning.status,
    learning: {
      readings: learning.readings,
      spanDays: learning.spanDays,
      readingsNeeded: learning.readingsNeeded,
      daysNeeded: learning.daysNeeded,
    },
    avgKwhDay: null,
    priceKwh,
    costPerDay: null,
    balanceKwh: null,
    daysRemaining: null,
    cutoffAt: null,
    monthlyEstimateFcfa: null,
    lastReading,
    cycleKey,
    anomaly: false,
    segments,
  };

  // Le solde estimé reste utile même pendant l'apprentissage.
  if (kind === "prepaid" && lastReading) {
    base.balanceKwh = lastReading.value + rechargedBetween(recharges, t(lastReading.takenAt), opts.now.getTime());
  }

  if (learning.status === "insufficient") return base;

  const avg = weightedAverage(segments, opts.now);
  if (avg === null) return base;
  base.avgKwhDay = avg;
  base.costPerDay = avg * priceKwh;
  base.anomaly = detectAnomaly(segments, opts.now, opts.anomalyRatio);

  if (kind === "postpaid") {
    base.monthlyEstimateFcfa = avg * 30 * priceKwh;
    return base;
  }

  if (!lastReading || base.balanceKwh === null) return base;
  // Débit prudent : on suppose `safetyMargin` de consommation en plus.
  const safeRate = avg * (1 + opts.safetyMargin);
  const elapsedDays = (opts.now.getTime() - t(lastReading.takenAt)) / DAY_MS;
  const balanceNow = Math.max(0, base.balanceKwh - avg * elapsedDays);
  base.balanceKwh = balanceNow;
  if (safeRate <= 0) {
    // Aucune consommation mesurée : pas de date de coupure à annoncer.
    return base;
  }
  const days = balanceNow / safeRate;
  base.daysRemaining = days;
  base.cutoffAt = new Date(opts.now.getTime() + days * DAY_MS).toISOString();
  return base;
}

/**
 * Anomalie (BF-18) : le dernier segment d'au moins 12 h consomme au moins
 * `ratio` fois la moyenne des segments précédents.
 */
export function detectAnomaly(segments: Segment[], now: Date, ratio: number): boolean {
  if (segments.length < 2) return false;
  const last = segments[segments.length - 1];
  if (last.days * 24 < ANOMALY_MIN_HOURS) return false;
  const before = weightedAverage(segments.slice(0, -1), now);
  if (before === null || before <= 0) return false;
  return last.rate >= ratio * before;
}

export type CheckLevel = "error" | "warning";

export interface CheckResult {
  code: "negative" | "future" | "index_down" | "balance_up" | "sharp_drop" | "duplicate";
  level: CheckLevel;
  message: string;
}

/**
 * Contrôles de cohérence d'un nouveau relevé (BF-06).
 * Une erreur bloque l'enregistrement ; un avertissement demande confirmation.
 */
export function checkReading(
  kind: MeterKind,
  candidate: { takenAt: string; value: number },
  history: Reading[],
  recharges: Recharge[],
  now: Date,
): CheckResult[] {
  const out: CheckResult[] = [];
  const at = t(candidate.takenAt);
  if (!Number.isFinite(candidate.value) || candidate.value < 0) {
    out.push({ code: "negative", level: "error", message: "La valeur doit être un nombre positif." });
    return out;
  }
  if (at > now.getTime() + 5 * 60_000) {
    out.push({ code: "future", level: "error", message: "La date du relevé est dans le futur." });
  }
  const sorted = sortReadings(history);
  let prev: Reading | null = null;
  for (const r of sorted) if (t(r.takenAt) <= at) prev = r;
  if (!prev) return out;

  if (t(prev.takenAt) === at && prev.value === candidate.value) {
    out.push({ code: "duplicate", level: "warning", message: "Ce relevé existe déjà." });
  }

  if (kind === "postpaid") {
    if (candidate.value < prev.value) {
      out.push({
        code: "index_down",
        level: "error",
        message: `L'index ne peut pas baisser : le dernier relevé indiquait ${fmt(prev.value)} kWh.`,
      });
    }
    return out;
  }

  const added = rechargedBetween(recharges, t(prev.takenAt), at);
  const expectedMax = prev.value + added;
  if (candidate.value > expectedMax + READING_TOLERANCE_KWH) {
    out.push({
      code: "balance_up",
      level: "warning",
      message:
        "Ton solde a augmenté sans recharge enregistrée. As-tu oublié d'ajouter une recharge ?",
    });
    return out;
  }

  const consumed = expectedMax - candidate.value;
  const days = (at - t(prev.takenAt)) / DAY_MS;
  const segments = buildSegments(kind, sorted, recharges);
  const avg = weightedAverage(segments, now);
  if (avg && avg > 0 && days * 24 >= 1) {
    if (consumed / Math.max(days, 1 / 24) > 3 * avg && consumed > 2) {
      out.push({
        code: "sharp_drop",
        level: "warning",
        message: `Chute inhabituelle : ${fmt(consumed)} kWh consommés depuis le dernier relevé. Vérifie la valeur lue.`,
      });
    }
  }
  return out;
}

function fmt(n: number): string {
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
}

export type GaugeLevel = "green" | "amber" | "red" | "unknown";

export function gaugeLevel(days: number | null, thresholds: { j5: number; j2: number }): GaugeLevel {
  if (days === null) return "unknown";
  if (days <= thresholds.j2) return "red";
  if (days <= thresholds.j5) return "amber";
  return "green";
}

/** Consommation estimée par jour calendaire, pour l'historique (BF-12). */
export function dailyConsumption(
  segments: Segment[],
  days: number,
  now: Date,
): { date: string; kwh: number | null }[] {
  const out: { date: string; kwh: number | null }[] = [];
  const today = new Date(now.toISOString().slice(0, 10) + "T00:00:00Z").getTime();
  for (let i = days - 1; i >= 0; i--) {
    const start = today - i * DAY_MS;
    const end = start + DAY_MS;
    let kwh = 0;
    let covered = 0;
    for (const s of segments) {
      const a = Math.max(start, t(s.from));
      const b = Math.min(end, t(s.to));
      if (b > a) {
        kwh += (s.rate * (b - a)) / DAY_MS;
        covered += b - a;
      }
    }
    out.push({ date: new Date(start).toISOString().slice(0, 10), kwh: covered > 0 ? kwh : null });
  }
  return out;
}
