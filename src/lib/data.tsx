// Données de l'utilisateur connecté : offres, réglages, compteurs, et
// historique de chaque compteur (mis en cache le temps de la session).
import { computeForecast, type Forecast, type Reading, type Recharge } from "@shared/prevision.ts";
import { type AccessStatus, accessStatus, trialDaysLeft } from "@shared/acces.ts";
import { resolveSettings, type Settings } from "@shared/reglages.ts";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { FullPageSpinner } from "@/components/ui";
import { useAuth } from "./auth";
import { callFunction, supabase } from "./supabase";
import { type BillRow, effectivePlanCode, type Meter, type MeterAccess, type Plan, type ReadingRow, type RechargeRow, type ShareRow } from "./types";

export interface MeterHistory {
  readings: ReadingRow[];
  recharges: RechargeRow[];
  /** Factures postpayées, de la plus récente à la plus ancienne (BF-14). */
  bills: BillRow[];
  loadedAt: number;
}

interface DataState {
  ready: boolean;
  plans: Plan[];
  settings: Settings;
  /** Compteurs visibles : les miens et ceux partagés avec moi. */
  meters: Meter[];
  /** Compteurs dont je suis propriétaire (ils comptent dans la limite de l'offre). */
  ownedMeters: Meter[];
  /** Partages visibles : ceux de mes compteurs, ceux dont je suis membre, mes invitations. */
  shares: ShareRow[];
  /** Invitations reçues, en attente de ma réponse. */
  invitations: ShareRow[];
  access: (meter: Meter) => MeterAccess;
  refreshShares: () => Promise<void>;
  currentPlan: Plan | null;
  /** Offre payée, essai en cours, ou essai terminé (lecture seule). */
  subscription: { status: AccessStatus; trialDaysLeft: number | null; readOnly: boolean };
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
  const [allMeters, setMeters] = useState<Meter[]>([]);
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(readSelected);
  const [histories, setHistories] = useState<Record<string, MeterHistory>>({});
  const [error, setError] = useState<string | null>(null);

  const refreshShares = useCallback(async () => {
    const { data, error } = await supabase.from("meter_shares").select("*").order("created_at");
    if (error) throw error;
    // Comme pour les compteurs : l'équipe lit tous les partages, on ne garde que les miens.
    const me = profile?.id;
    const email = profile?.email?.toLowerCase();
    setShares((data as ShareRow[]).filter((s) => s.owner_id === me || s.member_id === me || (s.status === "pending" && s.email === email)));
  }, [profile?.id, profile?.email]);

  const refreshMeters = useCallback(async () => {
    const [m] = await Promise.all([supabase.from("meters").select("*").order("created_at"), refreshShares()]);
    if (m.error) throw m.error;
    setMeters(m.data as Meter[]);
    return m.data as Meter[];
  }, [refreshShares]);

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
    const [r, c, b] = await Promise.all([
      supabase.from("readings").select("*").eq("meter_id", meterId).gte("taken_at", since).order("taken_at"),
      supabase.from("recharges").select("*").eq("meter_id", meterId).gte("purchased_at", since).order("purchased_at"),
      supabase.from("bills").select("*").eq("meter_id", meterId).order("period_end", { ascending: false }).limit(12),
    ]);
    if (r.error) throw r.error;
    if (c.error) throw c.error;
    if (b.error) throw b.error;
    const h: MeterHistory = {
      readings: (r.data as ReadingRow[]).map((x) => ({ ...x, value: Number(x.value) })),
      recharges: (c.data as RechargeRow[]).map((x) => ({ ...x, kwh: Number(x.kwh), amount_fcfa: Number(x.amount_fcfa) })),
      bills: (b.data as BillRow[]).map((x) => ({
        ...x,
        kwh: Number(x.kwh),
        amount_fcfa: Number(x.amount_fcfa),
        index_start: x.index_start === null ? null : Number(x.index_start),
        index_end: x.index_end === null ? null : Number(x.index_end),
        fixed_fcfa: x.fixed_fcfa === null ? null : Number(x.fixed_fcfa),
      })),
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

  // La RLS laisse l'équipe (admin, support) lire tous les compteurs pour le
  // back-office : l'application, elle, ne montre que les miens et ceux qu'on
  // m'a vraiment partagés.
  const meters = useMemo(
    () => allMeters.filter((m) =>
      m.user_id === profile?.id ||
      shares.some((s) => s.meter_id === m.id && s.member_id === profile?.id && s.status === "accepted")),
    [allMeters, shares, profile?.id],
  );
  const selectedMeter = meters.find((m) => m.id === selectedId) ?? meters[0] ?? null;
  const currentPlan = plans.find((p) => p.code === effectivePlanCode(profile)) ?? null;
  const subscription = useMemo(() => {
    if (!profile) return { status: "expired" as AccessStatus, trialDaysLeft: null, readOnly: true };
    const now = new Date();
    const status = accessStatus(profile, now);
    return { status, trialDaysLeft: trialDaysLeft(profile, now), readOnly: status === "expired" };
  }, [profile]);
  const ownedMeters = useMemo(() => meters.filter((m) => m.user_id === profile?.id), [meters, profile?.id]);
  const invitations = useMemo(
    () => shares.filter((s) => s.status === "pending" && s.owner_id !== profile?.id && s.email === profile?.email?.toLowerCase()),
    [shares, profile?.id, profile?.email],
  );
  const access = useCallback((m: Meter): MeterAccess => {
    if (m.user_id === profile?.id) return "proprietaire";
    const s = shares.find((x) => x.meter_id === m.id && x.member_id === profile?.id && x.status === "accepted");
    return s?.role === "contributeur" ? "contributeur" : "lecteur";
  }, [shares, profile?.id]);

  const value = useMemo<DataState>(() => ({
    ready,
    plans,
    settings,
    meters,
    ownedMeters,
    shares,
    invitations,
    access,
    refreshShares,
    currentPlan,
    subscription,
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
  }), [ready, plans, settings, meters, ownedMeters, shares, invitations, access, refreshShares, currentPlan, subscription, selectedMeter, refreshMeters, histories, loadHistory, afterChange, error]);

  // Rien ne s'affiche avant le premier chargement : sinon une page ouverte
  // directement (/releve) croirait qu'il n'y a aucun compteur.
  return <DataContext.Provider value={value}>{ready ? children : <FullPageSpinner />}</DataContext.Provider>;
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
