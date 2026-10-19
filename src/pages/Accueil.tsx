// Accueil (BF-11) : jours restants, date probable de coupure, moyenne et
// coût par jour, dernier relevé ; phase d'apprentissage (BF-10).
import { gaugeLevel } from "@shared/prevision.ts";
import { useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { CutoffQuestion } from "@/components/CutoffQuestion";
import { Gauge } from "@/components/Gauge";
import { MeterPicker } from "@/components/MeterPicker";
import { Card, FullPageSpinner, Notice } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useData, useForecast } from "@/lib/data";
import { fcfa, fmtAgo, fmtDateLong, fmtTime, kwh, num } from "@/lib/format";
import { pushState } from "@/lib/push";
import { supabase } from "@/lib/supabase";

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-3">
      <p className="text-xs font-medium text-stone-500">{label}</p>
      <p className="tabular mt-1 text-xl font-bold text-stone-900">{value}</p>
      {sub && <p className="text-xs text-stone-500">{sub}</p>}
    </Card>
  );
}

export default function Accueil() {
  const { profile } = useAuth();
  const { ready, meters, selectedMeter, selectMeter, settings, error } = useData();
  const [params] = useSearchParams();
  const { forecast, loading } = useForecast(selectedMeter);
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

  if (!ready) return <FullPageSpinner />;
  if (meters.length === 0) return <Navigate to="/compteurs?premier=1" replace />;
  if (!selectedMeter || !profile) return null;

  const meter = selectedMeter;
  const level = gaugeLevel(forecast?.daysRemaining ?? null, settings.thresholds);
  const learning = forecast?.status === "insufficient";
  const last = forecast?.lastReading;
  const askKey = forecast ? `${meter.id}:${forecast.cycleKey}` : "";

  return (
    <div className="space-y-4">
      <div>
        <p className="text-stone-600">Bonjour {profile.first_name} 👋</p>
      </div>
      <MeterPicker />
      {error && <Notice tone="error">{error}</Notice>}

      {loading && !forecast ? (
        <Card className="h-64 animate-pulse bg-stone-100"><span className="sr-only">Chargement</span></Card>
      ) : meter.kind === "prepaid" ? (
        <Card className="pt-6 text-center">
          <Gauge
            days={learning ? null : forecast?.daysRemaining ?? null}
            level={learning ? "unknown" : level}
            label={learning ? "Prévision en cours d'apprentissage" : `${num(forecast?.daysRemaining ?? null, 1)} jours de courant restants`}
          />
          {learning ? (
            <div className="mt-4 space-y-1">
              <p className="font-semibold text-stone-900">J'apprends ta consommation</p>
              <p className="text-sm text-stone-600">
                {forecast!.learning.readingsNeeded > 0
                  ? `Encore ${forecast!.learning.readingsNeeded} relevé${forecast!.learning.readingsNeeded > 1 ? "s" : ""}`
                  : "Encore un peu de patience"}
                {forecast!.learning.daysNeeded > 0 ? `, sur ${forecast!.learning.daysNeeded} jour${forecast!.learning.daysNeeded > 1 ? "s" : ""} de plus` : ""} pour ta première prévision.
              </p>
            </div>
          ) : forecast?.cutoffAt && forecast.daysRemaining !== null ? (
            <div className="mt-4">
              <p className="text-sm text-stone-500">Coupure probable</p>
              <p className="text-lg font-bold text-stone-900 first-letter:uppercase">
                {fmtDateLong(forecast.cutoffAt)} vers {fmtTime(forecast.cutoffAt)}
              </p>
              <p className="mt-1 text-xs text-stone-500">
                Estimation prudente (+{Math.round(settings.safetyMargin * 100)} % de marge)
                {forecast.status === "preliminary" ? ", affinée après 7 jours de relevés" : ""}.
              </p>
            </div>
          ) : (
            <p className="mt-4 text-sm text-stone-600">Aucune consommation mesurée sur la période.</p>
          )}
        </Card>
      ) : (
        <Card className="text-center">
          <p className="text-sm text-stone-500">Estimation sur 30 jours</p>
          <p className="tabular mt-1 text-4xl font-extrabold text-stone-900">{learning ? "–" : fcfa(forecast?.monthlyEstimateFcfa ?? null)}</p>
          <p className="mt-2 text-sm text-stone-600">
            {learning
              ? "Encore quelques relevés d'index pour estimer ta prochaine facture."
              : "D'après ta consommation récente et le prix moyen du kWh."}
          </p>
        </Card>
      )}

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

      <div className="grid grid-cols-2 gap-3">
        <Link to={`/releve?compteur=${meter.id}`} className="flex min-h-14 items-center justify-center rounded-2xl bg-brand-600 text-lg font-bold text-white shadow-sm active:bg-brand-700">
          Relever
        </Link>
        {meter.kind === "prepaid" ? (
          <Link to={`/recharge?compteur=${meter.id}`} className="flex min-h-14 items-center justify-center rounded-2xl bg-white text-lg font-bold text-brand-700 ring-1 ring-brand-200 active:bg-brand-50">
            Recharge
          </Link>
        ) : (
          <Link to="/historique" className="flex min-h-14 items-center justify-center rounded-2xl bg-white text-lg font-bold text-brand-700 ring-1 ring-brand-200">
            Historique
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Stat label="Moyenne par jour" value={kwh(forecast?.avgKwhDay ?? null)} />
        <Stat label="Coût par jour" value={fcfa(forecast?.costPerDay ?? null)} sub={forecast ? `${num(forecast.priceKwh, 0)} FCFA / kWh` : undefined} />
        {meter.kind === "prepaid" && <Stat label="Crédit estimé" value={kwh(forecast?.balanceKwh ?? null)} />}
        <Stat label="Dernier relevé" value={last ? kwh(last.value) : "–"} sub={last ? fmtAgo(last.takenAt) : "aucun"} />
      </div>

      {push === "off" && (
        <Notice>
          Active les notifications pour être prévenu avant la coupure. <Link to="/alertes" className="font-semibold underline">Activer</Link>
        </Notice>
      )}
      {push === "ios-install" && (
        <Notice>
          Sur iPhone, ajoute PréviÉnergie à l'écran d'accueil pour recevoir les alertes. <Link to="/alertes" className="font-semibold underline">Comment faire</Link>
        </Notice>
      )}
    </div>
  );
}
