// Tableau de bord (BF-11) : jours restants, date probable de coupure, moyenne
// et coût par jour, dernier relevé ; phase d'apprentissage (BF-10).
import { dailyConsumption, gaugeLevel, type GaugeLevel } from "@shared/prevision.ts";
import { TIME_ZONE } from "@shared/temps.ts";
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { BarChart } from "@/components/BarChart";
import { CutoffQuestion } from "@/components/CutoffQuestion";
import { Gauge } from "@/components/Gauge";
import { Icon, type IconName } from "@/components/icons";
import { MeterPicker } from "@/components/MeterPicker";
import { Card, Notice } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useData, useForecast } from "@/lib/data";
import { fcfa, fmtAgo, fmtDate, fmtDateLong, fmtDateTime, fmtTime, kwh, num } from "@/lib/format";
import { pushState } from "@/lib/push";
import { R, withQuery } from "@/lib/routes";
import { supabase } from "@/lib/supabase";

const STATUS: Record<GaugeLevel, { label: string; dot: string }> = {
  green: { label: "Tout va bien", dot: "bg-emerald-400" },
  amber: { label: "Pense à recharger", dot: "bg-amber-300" },
  red: { label: "Recharge vite", dot: "bg-red-400" },
  unknown: { label: "Apprentissage en cours", dot: "bg-white/70" },
};

const today = new Intl.DateTimeFormat("fr-FR", { timeZone: TIME_ZONE, weekday: "long", day: "numeric", month: "long" });

function Stat({ icon, label, value, sub }: { icon: IconName; label: string; value: string; sub?: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-stone-500">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-brand-50 text-brand-700"><Icon name={icon} className="h-4 w-4" /></span>
        <p className="text-xs font-semibold">{label}</p>
      </div>
      <p className="tabular mt-3 text-2xl font-extrabold text-stone-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-stone-500">{sub}</p>}
    </Card>
  );
}

export default function Accueil() {
  const { profile } = useAuth();
  const { meters, selectedMeter, selectMeter, settings, error } = useData();
  const [params] = useSearchParams();
  const { forecast, history, loading } = useForecast(selectedMeter);
  const [push, setPush] = useState<string | null>(null);
  const [feedbackDone, setFeedbackDone] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const id = params.get("compteur");
    if (id && meters.some((m) => m.id === id)) selectMeter(id);
  }, [params, meters]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    pushState().then(setPush).catch(() => setPush(null));
  }, []);

  const cycleKey = forecast?.cycleKey;
  const exhausted = selectedMeter?.kind === "prepaid" && forecast?.daysRemaining === 0;
  useEffect(() => {
    if (!selectedMeter || !cycleKey || !exhausted) return;
    const key = `${selectedMeter.id}:${cycleKey}`;
    if (key in feedbackDone) return;
    supabase.from("cutoff_feedback").select("id").eq("meter_id", selectedMeter.id).eq("cycle_key", cycleKey).limit(1)
      .then(({ data }) => setFeedbackDone((f) => ({ ...f, [key]: !!data?.length })));
  }, [selectedMeter?.id, cycleKey, exhausted]); // eslint-disable-line react-hooks/exhaustive-deps

  const bars = useMemo(() => {
    if (!forecast) return [];
    return dailyConsumption(forecast.segments, 14, new Date()).map((d) => ({
      label: String(Number(d.date.slice(8, 10))),
      title: fmtDate(`${d.date}T12:00:00Z`),
      value: d.kwh,
    }));
  }, [forecast]);

  const recent = useMemo(() => {
    const items = [
      ...(history?.readings ?? []).map((r) => ({ id: `r${r.id}`, at: r.taken_at, kind: "releve" as const, text: `Relevé ${kwh(r.value)}`, sub: r.source === "photo" ? "par photo" : "saisi" })),
      ...(history?.recharges ?? []).map((r) => ({ id: `c${r.id}`, at: r.purchased_at, kind: "recharge" as const, text: `Recharge +${kwh(r.kwh)}`, sub: r.amount_fcfa ? fcfa(r.amount_fcfa) : "" })),
    ];
    return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);
  }, [history]);

  if (meters.length === 0) return <Navigate to={withQuery(R.compteurs, { premier: 1 })} replace />;
  if (!selectedMeter || !profile) return null;

  const meter = selectedMeter;
  const learning = forecast?.status === "insufficient";
  const level: GaugeLevel = learning || !forecast ? "unknown" : gaugeLevel(forecast.daysRemaining, settings.thresholds);
  const last = forecast?.lastReading;
  const askKey = forecast ? `${meter.id}:${forecast.cycleKey}` : "";
  const prepaid = meter.kind === "prepaid";
  const progress = forecast
    ? Math.min(1, (Math.min(forecast.learning.readings, 3) / 3) * 0.5 + Math.min(forecast.learning.spanDays / 1.75, 1) * 0.5)
    : 0;

  return (
    <div className="space-y-6">
      {/* En-tête de page */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-stone-500 first-letter:uppercase">{today.format(new Date())}</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-stone-900 sm:text-3xl">Bonjour {profile.first_name} 👋</h1>
        </div>
        <div className="hidden gap-2 sm:flex">
          <Link to={withQuery(R.releve, { compteur: meter.id })} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-brand-600/25 hover:bg-brand-700">
            <Icon name="camera" className="h-4 w-4" /> Nouveau relevé
          </Link>
          {prepaid && (
            <Link to={withQuery(R.recharge, { compteur: meter.id })} className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-brand-700 ring-1 ring-brand-200 hover:bg-brand-50">
              <Icon name="receipt" className="h-4 w-4" /> Recharge
            </Link>
          )}
        </div>
      </div>

      <MeterPicker />
      {error && <Notice tone="error">{error}</Notice>}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Carte vedette */}
        <section className="bg-hero relative overflow-hidden rounded-[1.75rem] p-6 text-white shadow-xl shadow-brand-700/20 sm:p-8 lg:col-span-2">
          <div className="absolute -top-16 -right-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" aria-hidden />
          <div className="relative flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/20"><Icon name="meter" className="h-5 w-5" /></span>
              <div>
                <p className="font-bold">{meter.name}</p>
                <p className="text-xs text-white/75">{prepaid ? "Prépayé" : "Postpayé"}{meter.number ? ` · n° ${meter.number}` : ""}</p>
              </div>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full bg-white/20 px-3 py-1 text-sm font-semibold ring-1 ring-white/30">
              <span className={`h-2 w-2 rounded-full ${STATUS[level].dot}`} /> {STATUS[level].label}
            </span>
          </div>

          {loading && !forecast ? (
            <div className="relative mt-8 h-48 animate-pulse rounded-2xl bg-white/10" />
          ) : prepaid ? (
            <div className="relative mt-6 grid items-center gap-6 sm:grid-cols-2">
              <Gauge
                days={learning ? null : forecast?.daysRemaining ?? null}
                level={level}
                onColor
                size="lg"
                label={learning ? "Prévision en cours d'apprentissage" : `${num(forecast?.daysRemaining ?? null, 1)} jours de courant restants`}
              />
              <div>
                {learning ? (
                  <>
                    <p className="text-xl font-extrabold">J'apprends ta consommation</p>
                    <p className="mt-2 text-sm text-white/85">
                      {forecast!.learning.readingsNeeded > 0
                        ? `Encore ${forecast!.learning.readingsNeeded} relevé${forecast!.learning.readingsNeeded > 1 ? "s" : ""}`
                        : "Encore un peu de patience"}
                      {forecast!.learning.daysNeeded > 0 ? `, sur ${forecast!.learning.daysNeeded} jour${forecast!.learning.daysNeeded > 1 ? "s" : ""} de plus` : ""} pour ta première prévision.
                    </p>
                    <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-white/20" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                      <div className="h-full rounded-full bg-white transition-all" style={{ width: `${Math.max(6, progress * 100)}%` }} />
                    </div>
                  </>
                ) : forecast?.cutoffAt && forecast.daysRemaining !== null ? (
                  <>
                    <p className="text-sm text-white/80">Coupure probable</p>
                    <p className="mt-1 text-2xl leading-tight font-extrabold first-letter:uppercase">{fmtDateLong(forecast.cutoffAt)}</p>
                    <p className="text-lg font-bold text-white/90">vers {fmtTime(forecast.cutoffAt)}</p>
                    <p className="mt-3 text-xs text-white/75">
                      Estimation prudente (+{Math.round(settings.safetyMargin * 100)} % de marge)
                      {forecast.status === "preliminary" ? ", affinée après 7 jours de relevés" : ""}.
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-white/85">Aucune consommation mesurée sur la période.</p>
                )}
                <div className="mt-5 flex gap-2 sm:hidden">
                  <Link to={withQuery(R.releve, { compteur: meter.id })} className="flex-1 rounded-xl bg-white py-3 text-center text-sm font-bold text-brand-700">Relever</Link>
                  <Link to={withQuery(R.recharge, { compteur: meter.id })} className="flex-1 rounded-xl bg-white/20 py-3 text-center text-sm font-bold text-white ring-1 ring-white/40">Recharge</Link>
                </div>
              </div>
            </div>
          ) : (
            <div className="relative mt-8">
              <p className="text-sm text-white/80">Estimation de ta prochaine facture (30 jours)</p>
              <p className="tabular mt-2 text-5xl font-extrabold">{learning ? "–" : fcfa(forecast?.monthlyEstimateFcfa ?? null)}</p>
              <p className="mt-3 text-sm text-white/85">
                {learning ? "Encore quelques relevés d'index pour estimer ta facture." : "D'après ta consommation récente et le prix moyen du kWh."}
              </p>
              <Link to={withQuery(R.releve, { compteur: meter.id })} className="mt-5 inline-block rounded-xl bg-white px-5 py-3 text-sm font-bold text-brand-700 sm:hidden">Relever l'index</Link>
            </div>
          )}
        </section>

        {/* Chiffres clés */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-1 lg:grid-rows-4 xl:grid-cols-2 xl:grid-rows-2">
          <Stat icon="trend" label="Moyenne par jour" value={kwh(forecast?.avgKwhDay ?? null)} />
          <Stat icon="wallet" label="Coût par jour" value={fcfa(forecast?.costPerDay ?? null)} sub={forecast ? `${num(forecast.priceKwh, 0)} FCFA / kWh` : undefined} />
          {prepaid ? <Stat icon="bolt" label="Crédit estimé" value={kwh(forecast?.balanceKwh ?? null)} /> : <Stat icon="bolt" label="Dernier index" value={last ? kwh(last.value) : "–"} />}
          <Stat icon="clock" label="Dernier relevé" value={last ? fmtAgo(last.takenAt) : "aucun"} sub={last && prepaid ? kwh(last.value) : undefined} />
        </div>
      </div>

      {forecast?.anomaly && (
        <Notice tone="warning">Ta consommation récente a doublé par rapport à d'habitude. Vérifie la climatisation, le congélateur ou un appareil resté allumé.</Notice>
      )}

      {exhausted && forecast && feedbackDone[askKey] === false && (
        <Card>
          <CutoffQuestion
            meterId={meter.id}
            cycleKey={forecast.cycleKey}
            question="D'après nos calculs, ton crédit devrait être épuisé. As-tu été coupé ?"
            onDone={() => setFeedbackDone((f) => ({ ...f, [askKey]: true }))}
          />
        </Card>
      )}

      {(push === "off" || push === "ios-install") && (
        <div className="flex flex-col gap-3 rounded-2xl bg-stone-900 p-5 text-white sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-500"><Icon name="bell" className="h-5 w-5" /></span>
            <p className="text-sm">
              {push === "off" ? "Active les notifications pour être prévenu avant la coupure." : "Sur iPhone, installe PréviÉnergie sur l'écran d'accueil pour recevoir les alertes."}
            </p>
          </div>
          <Link to={R.alertes} className="rounded-xl bg-white px-4 py-2 text-center text-sm font-bold text-stone-900">{push === "off" ? "Activer" : "Comment faire"}</Link>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold">Consommation des 14 derniers jours</h2>
            <Link to={R.historique} className="text-sm font-semibold text-brand-700">Tout l'historique →</Link>
          </div>
          <BarChart bars={bars} format={(v) => kwh(v)} emptyText="Les barres apparaîtront après deux relevés espacés de quelques heures." />
        </Card>
        <Card className="p-5">
          <h2 className="mb-3 font-bold">Activité récente</h2>
          {recent.length === 0 ? (
            <p className="text-sm text-stone-500">Aucun relevé pour l'instant.</p>
          ) : (
            <ul className="space-y-3">
              {recent.map((r) => (
                <li key={r.id} className="flex items-center gap-3">
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${r.kind === "recharge" ? "bg-emerald-50 text-emerald-700" : "bg-brand-50 text-brand-700"}`}>
                    <Icon name={r.kind === "recharge" ? "receipt" : "camera"} className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{r.text}</p>
                    <p className="truncate text-xs text-stone-500">{fmtDateTime(r.at)}{r.sub ? ` · ${r.sub}` : ""}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
