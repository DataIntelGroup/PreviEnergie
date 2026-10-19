// Données de l'utilisateur connecté : offres, réglages, compteurs, et
// historique de chaque compteur (mis en cache le temps de la session).
import { computeForecast, type Forecast, type Reading, type Recharge } from "@shared/prevision.ts";
import { resolveSettings, type Settings } from "@shared/reglages.ts";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "./auth";
import { callFunction, supabase } from "./supabase";
import { effectivePlanCode, type Meter, type Plan, type ReadingRow, type RechargeRow } from "./types";

export interface MeterHistory {
  readings: ReadingRow[];
  recharges: RechargeRow[];
  loadedAt: number;
}

interface DataState {
  ready: boolean;
  plans: Plan[];
  settings: Settings;
  meters: Meter[];
  currentPlan: Plan | null;
  selectedMeter: Meter | null;
  selectMeter: (id: string) => void;
  refreshMeters: () => Promise<Meter[]>;
  history: (meterId: string) => MeterHistory | undefined;
  loadHistory: (meterId: string, force?: boolean) => Promise<MeterHistory>;
  /** À appeler après un relevé ou une recharge : recharge l'historique et prévient le serveur. */
  afterChange: (meterId: string) => Promise<void>;
  error: string | null;
}

const DataContext = createContext<DataState | null>(null);
const SELECTED_KEY = "pe.compteur";
// Assez pour la moyenne (30 jours) et l'historique illimité affiché sur 90 jours.
const HISTORY_DAYS = 90;

function readSelected(): string | null {
  try {
    return localStorage.getItem(SELECTED_KEY);
  } catch {
    return null;
  }
}

export function DataProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const [ready, setReady] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [settings, setSettings] = useState<Settings>(resolveSettings([]));
  const [meters, setMeters] = useState<Meter[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(readSelected);
  const [histories, setHistories] = useState<Record<string, MeterHistory>>({});
  const [error, setError] = useState<string | null>(null);

  const refreshMeters = useCallback(async () => {
    const { data, error } = await supabase.from("meters").select("*").order("created_at");
    if (error) throw error;
    setMeters(data as Meter[]);
    return data as Meter[];
  }, []);

  useEffect(() => {
    if (!profile) return;
    let active = true;
    (async () => {
      try {
        const [p, s] = await Promise.all([
          supabase.from("plans").select("*").order("sort"),
          supabase.from("settings").select("key, value"),
        ]);
        if (p.error) throw p.error;
        if (s.error) throw s.error;
        if (!active) return;
        setPlans(p.data as Plan[]);
        setSettings(resolveSettings(s.data));
        await refreshMeters();
      } catch (e) {
        console.error(e);
        if (active) setError("Impossible de charger tes données. Vérifie ta connexion.");
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [profile?.id, refreshMeters]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadHistory = useCallback(async (meterId: string, force = false) => {
    const cached = histories[meterId];
    if (cached && !force && Date.now() - cached.loadedAt < 60_000) return cached;
    const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString();
    const [r, c] = await Promise.all([
      supabase.from("readings").select("*").eq("meter_id", meterId).gte("taken_at", since).order("taken_at"),
      supabase.from("recharges").select("*").eq("meter_id", meterId).gte("purchased_at", since).order("purchased_at"),
    ]);
    if (r.error) throw r.error;
    if (c.error) throw c.error;
    const h: MeterHistory = {
      readings: (r.data as ReadingRow[]).map((x) => ({ ...x, value: Number(x.value) })),
      recharges: (c.data as RechargeRow[]).map((x) => ({ ...x, kwh: Number(x.kwh), amount_fcfa: Number(x.amount_fcfa) })),
      loadedAt: Date.now(),
    };
    setHistories((prev) => ({ ...prev, [meterId]: h }));
    return h;
  }, [histories]);

  const afterChange = useCallback(async (meterId: string) => {
    await loadHistory(meterId, true);
    // Recalcul serveur (BF : « recalcul après chaque relevé »), sans bloquer l'écran.
    callFunction("prevision", { meterId }).catch((e) => console.warn("recalcul serveur", e));
  }, [loadHistory]);

  const selectedMeter = meters.find((m) => m.id === selectedId) ?? meters[0] ?? null;
  const currentPlan = plans.find((p) => p.code === effectivePlanCode(profile)) ?? null;

  const value = useMemo<DataState>(() => ({
    ready,
    plans,
    settings,
    meters,
    currentPlan,
    selectedMeter,
    selectMeter: (id) => {
      setSelectedId(id);
      try {
        localStorage.setItem(SELECTED_KEY, id);
      } catch {
        /* stockage indisponible : le choix vaut pour la session */
      }
    },
    refreshMeters,
    history: (id) => histories[id],
    loadHistory,
    afterChange,
    error,
  }), [ready, plans, settings, meters, currentPlan, selectedMeter, refreshMeters, histories, loadHistory, afterChange, error]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataState {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData hors de DataProvider");
  return ctx;
}

export function toEngine(h: MeterHistory | undefined): { readings: Reading[]; recharges: Recharge[] } {
  return {
    readings: (h?.readings ?? []).map((r) => ({ id: r.id, takenAt: r.taken_at, value: r.value })),
    recharges: (h?.recharges ?? []).map((r) => ({ id: r.id, purchasedAt: r.purchased_at, kwh: r.kwh, amountFcfa: r.amount_fcfa })),
  };
}

/** Prévision calculée dans le navigateur, avec le même moteur que le serveur. */
export function useForecast(meter: Meter | null): { forecast: Forecast | null; history: MeterHistory | undefined; loading: boolean } {
  const { history, loadHistory, settings } = useData();
  const h = meter ? history(meter.id) : undefined;
  const [loading, setLoading] = useState(!h);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!meter) return;
    setLoading(!history(meter.id));
    loadHistory(meter.id).catch(console.error).finally(() => setLoading(false));
  }, [meter?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // La jauge descend avec le temps : on recalcule chaque minute.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const forecast = useMemo(() => {
    if (!meter || !h) return null;
    const { readings, recharges } = toEngine(h);
    return computeForecast(meter.kind, readings, recharges, {
      now,
      safetyMargin: settings.safetyMargin,
      defaultPriceKwh: settings.defaultPriceKwh,
      anomalyRatio: settings.anomalyRatio,
    });
  }, [meter, h, settings, now]);

  return { forecast, history: h, loading };
}
