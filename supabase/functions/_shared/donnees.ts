// Lecture des relevés et recharges d'un ensemble de compteurs, calcul de la
// prévision et mise à jour de la table forecasts. Utilisé par la tâche
// horaire et par le recalcul après chaque relevé.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import { computeForecast, type Forecast, type MeterKind, type Reading, type Recharge } from "./prevision.ts";
import { resolveSettings, type Settings } from "./reglages.ts";
import { DAY_MS } from "./temps.ts";

export interface MeterRow {
  id: string;
  user_id: string;
  name: string;
  kind: MeterKind;
  created_at: string;
}

export async function loadSettings(db: SupabaseClient): Promise<Settings> {
  const { data, error } = await db.from("settings").select("key, value");
  if (error) throw error;
  return resolveSettings(data);
}

/** Relevés (45 jours) et recharges (90 jours), regroupés par compteur. */
export async function loadHistory(db: SupabaseClient, meterIds: string[], now: Date) {
  const readings = new Map<string, Reading[]>();
  const recharges = new Map<string, Recharge[]>();
  for (const id of meterIds) {
    readings.set(id, []);
    recharges.set(id, []);
  }
  if (meterIds.length === 0) return { readings, recharges };

  // Par paquets, pour rester sous la limite de taille d'URL de PostgREST.
  for (let i = 0; i < meterIds.length; i += 100) {
    const ids = meterIds.slice(i, i + 100);
    const [r, c] = await Promise.all([
      db.from("readings").select("id, meter_id, taken_at, value")
        .in("meter_id", ids)
        .gte("taken_at", new Date(now.getTime() - 45 * DAY_MS).toISOString())
        .order("taken_at"),
      db.from("recharges").select("id, meter_id, purchased_at, kwh, amount_fcfa")
        .in("meter_id", ids)
        .gte("purchased_at", new Date(now.getTime() - 90 * DAY_MS).toISOString()),
    ]);
    if (r.error) throw r.error;
    if (c.error) throw c.error;
    for (const row of r.data ?? []) {
      readings.get(row.meter_id)!.push({ id: row.id, takenAt: row.taken_at, value: Number(row.value) });
    }
    for (const row of c.data ?? []) {
      recharges.get(row.meter_id)!.push({
        id: row.id,
        purchasedAt: row.purchased_at,
        kwh: Number(row.kwh),
        amountFcfa: Number(row.amount_fcfa),
      });
    }
  }
  return { readings, recharges };
}

export function forecastFor(
  meter: MeterRow,
  readings: Reading[],
  recharges: Recharge[],
  settings: Settings,
  now: Date,
): Forecast {
  return computeForecast(meter.kind, readings, recharges, {
    now,
    safetyMargin: settings.safetyMargin,
    defaultPriceKwh: settings.defaultPriceKwh,
    anomalyRatio: settings.anomalyRatio,
  });
}

export function forecastRow(meter: MeterRow, f: Forecast, now: Date) {
  const round = (n: number | null, d: number) => (n === null ? null : Number(n.toFixed(d)));
  return {
    meter_id: meter.id,
    user_id: meter.user_id,
    computed_at: now.toISOString(),
    status: f.status,
    avg_kwh_day: round(f.avgKwhDay, 3),
    balance_kwh: round(f.balanceKwh, 2),
    days_remaining: round(f.daysRemaining, 2),
    cutoff_at: f.cutoffAt,
    cycle_key: f.cycleKey,
    anomaly: f.anomaly,
  };
}
