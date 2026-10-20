// Estimation de la prochaine facture postpayée (BF-14), à partir de la
// dernière facture réelle de l'abonné. Aucun barème CIE n'est codé ici :
// la facture fournit la durée de période, la part fixe (prime fixe et
// taxes) et le prix réel du kWh, TVA comprise.

import type { Reading } from "./prevision.ts";
import { addDays, DAY_MS, daysBetween } from "./temps.ts";

export interface Bill {
  periodStart: string; // AAAA-MM-JJ
  periodEnd: string;
  indexStart: number | null;
  indexEnd: number | null;
  kwh: number;
  amountFcfa: number;
  /** Prime fixe TTC + autres taxes, si l'abonné l'a saisie (ou la photo l'a lue). */
  fixedFcfa: number | null;
}

export type EstimateBasis = "index" | "moyenne" | "derniere_facture";

export interface BillEstimate {
  periodStart: string;
  periodEnd: string;
  periodDays: number;
  elapsedDays: number;
  /** kWh consommés depuis le début de la période en cours. */
  consumedKwh: number;
  projectedKwh: number;
  amountFcfa: number;
  fixedFcfa: number;
  priceKwh: number;
  lastAmountFcfa: number;
  /** Écart avec la dernière facture : 0,12 = +12 %. */
  change: number;
  basis: EstimateBasis;
  /** Plus d'une période s'est écoulée depuis la dernière facture saisie. */
  stale: boolean;
}

/** En dessous d'une semaine de relevés, le rythme de la dernière facture complète l'estimation. */
export const PRIOR_DAYS = 7;

/** Part fixe et prix du kWh tirés d'une facture. */
export function billPricing(b: Bill): { fixedFcfa: number; priceKwh: number } {
  const fixed = b.fixedFcfa !== null && b.fixedFcfa >= 0 && b.fixedFcfa < b.amountFcfa ? b.fixedFcfa : 0;
  return { fixedFcfa: fixed, priceKwh: (b.amountFcfa - fixed) / b.kwh };
}

export function latestBill(bills: Bill[]): Bill | null {
  let last: Bill | null = null;
  for (const b of bills) if (!last || b.periodEnd > last.periodEnd) last = b;
  return last;
}

/**
 * Estimation de la facture de la période en cours.
 * - « index » : un relevé d'index postérieur à la dernière facture donne la
 *   consommation exacte depuis son nouvel index ; on projette le reste avec la moyenne.
 * - « moyenne » : moyenne journalière × durée de la période.
 * - « derniere_facture » : faute de mieux, même consommation que la dernière facture.
 */
export function estimateBill(
  bills: Bill[],
  readings: Reading[],
  avgKwhDay: number | null,
  now: Date,
): BillEstimate | null {
  const last = latestBill(bills);
  if (!last) return null;
  const periodDays = Math.max(1, daysBetween(last.periodStart, last.periodEnd));
  const { fixedFcfa, priceKwh } = billPricing(last);

  // Période en cours : celle qui suit la dernière facture, ou une suivante
  // si l'abonné n'a pas saisi les factures intermédiaires.
  const today = now.toISOString().slice(0, 10);
  let start = last.periodEnd;
  let stale = false;
  while (daysBetween(start, today) >= periodDays) {
    start = addDays(start, periodDays);
    stale = true;
  }
  const end = addDays(start, periodDays);
  const startMs = new Date(`${start}T00:00:00Z`).getTime();
  const elapsedDays = Math.max(0, (now.getTime() - startMs) / DAY_MS);
  const remainingDays = Math.max(0, periodDays - elapsedDays);

  let basis: EstimateBasis = "derniere_facture";
  let consumed = 0;
  let projected = last.kwh;

  // Index exact : dernier relevé postérieur au nouvel index de la facture.
  const afterBill = readings
    .filter((r) => new Date(r.takenAt).getTime() >= new Date(`${last.periodEnd}T00:00:00Z`).getTime())
    .sort((a, b) => a.takenAt.localeCompare(b.takenAt));
  const latest = afterBill.at(-1);
  if (!stale && last.indexEnd !== null && latest && latest.value >= last.indexEnd) {
    const sinceBill = latest.value - last.indexEnd;
    const sinceReadingDays = Math.max(0, (now.getTime() - new Date(latest.takenAt).getTime()) / DAY_MS);
    const readingElapsed = Math.max(0, (new Date(latest.takenAt).getTime() - startMs) / DAY_MS);
    // Sans moyenne fiable, on lisse avec le rythme de la dernière facture :
    // il pèse autant que les jours qui manquent pour atteindre une semaine.
    const priorRate = last.kwh / periodDays;
    const rate = avgKwhDay ?? (sinceBill + priorRate * Math.max(0, PRIOR_DAYS - readingElapsed)) / Math.max(readingElapsed, PRIOR_DAYS);
    consumed = sinceBill + rate * sinceReadingDays;
    projected = consumed + rate * remainingDays;
    basis = "index";
  }
  if (basis === "derniere_facture" && avgKwhDay !== null) {
    consumed = avgKwhDay * elapsedDays;
    projected = avgKwhDay * periodDays;
    basis = "moyenne";
  }
  if (basis === "derniere_facture") consumed = (last.kwh / periodDays) * elapsedDays;

  const amount = fixedFcfa + projected * priceKwh;
  return {
    periodStart: start,
    periodEnd: end,
    periodDays,
    elapsedDays,
    consumedKwh: consumed,
    projectedKwh: projected,
    amountFcfa: amount,
    fixedFcfa,
    priceKwh,
    lastAmountFcfa: last.amountFcfa,
    change: last.amountFcfa > 0 ? amount / last.amountFcfa - 1 : 0,
    basis,
    stale,
  };
}
