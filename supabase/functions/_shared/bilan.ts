// Bilan hebdomadaire de consommation et de dépenses (BF-21).
import type { Recharge, Segment } from "./prevision.ts";
import { DAY_MS } from "./temps.ts";

/** kWh consommés entre deux instants, et jours effectivement couverts par des relevés. */
export function consumptionInWindow(segments: Segment[], from: number, to: number): { kwh: number; coveredDays: number } {
  let kwh = 0;
  let covered = 0;
  for (const s of segments) {
    const a = Math.max(from, new Date(s.from).getTime());
    const b = Math.min(to, new Date(s.to).getTime());
    if (b > a) {
      kwh += (s.rate * (b - a)) / DAY_MS;
      covered += b - a;
    }
  }
  return { kwh, coveredDays: covered / DAY_MS };
}

export interface WeeklySummary {
  kwh: number;
  previousKwh: number | null;
  /** 0,15 = +15 % par rapport à la semaine précédente ; null sans point de comparaison. */
  change: number | null;
  spendFcfa: number;
  avgKwhDay: number;
  coveredDays: number;
}

/**
 * Les 7 jours qui précèdent `now`, comparés aux 7 d'avant. Sans au moins
 * 3 jours couverts par des relevés, il n'y a pas de bilan à envoyer.
 */
export function weeklySummary(segments: Segment[], recharges: Recharge[], now: Date): WeeklySummary | null {
  const end = now.getTime();
  const start = end - 7 * DAY_MS;
  const cur = consumptionInWindow(segments, start, end);
  if (cur.coveredDays < 3) return null;
  const prev = consumptionInWindow(segments, start - 7 * DAY_MS, start);
  // Les semaines peu couvertes sont ramenées à 7 jours pour rester comparables.
  const curKwh = (cur.kwh / cur.coveredDays) * 7;
  const prevKwh = prev.coveredDays >= 3 ? (prev.kwh / prev.coveredDays) * 7 : null;
  const spend = recharges
    .filter((r) => {
      const t = new Date(r.purchasedAt).getTime();
      return t > start && t <= end;
    })
    .reduce((s, r) => s + r.amountFcfa, 0);
  return {
    kwh: curKwh,
    previousKwh: prevKwh,
    change: prevKwh && prevKwh > 0 ? curKwh / prevKwh - 1 : null,
    spendFcfa: spend,
    avgKwhDay: curKwh / 7,
    coveredDays: cur.coveredDays,
  };
}

export function formatChange(change: number | null): string {
  if (change === null) return "première semaine suivie";
  const pct = Math.round(change * 100);
  if (Math.abs(pct) < 3) return "stable par rapport à la semaine dernière";
  return `${pct > 0 ? "+" : "−"}${Math.abs(pct)} % par rapport à la semaine dernière`;
}
