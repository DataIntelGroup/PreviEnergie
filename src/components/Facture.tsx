// Estimation de la prochaine facture postpayée (BF-14) et bilan de la
// semaine (BF-21), affichés sur le tableau de bord.
import { formatChange, type WeeklySummary } from "@shared/bilan.ts";
import { type Bill, type BillEstimate } from "@shared/facture.ts";
import { Link } from "react-router-dom";
import { fcfa, fmtDate, kwh } from "@/lib/format";
import { R, withQuery } from "@/lib/routes";
import type { BillRow } from "@/lib/types";
import { Icon } from "./icons";
import { Card } from "./ui";

export function toBill(b: BillRow): Bill {
  return {
    periodStart: b.period_start,
    periodEnd: b.period_end,
    indexStart: b.index_start,
    indexEnd: b.index_end,
    kwh: b.kwh,
    amountFcfa: b.amount_fcfa,
    fixedFcfa: b.fixed_fcfa,
  };
}

const BASIS = {
  index: "D'après ton dernier relevé d'index, comparé à celui de ta facture.",
  moyenne: "D'après ta consommation moyenne. Un relevé d'index rendra l'estimation exacte.",
  derniere_facture: "Même consommation que ta dernière facture, faute de relevé récent.",
} as const;

/** Contenu de la carte vedette pour un compteur postpayé. */
export function BillHero({ estimate, monthly, learning, canEdit }: {
  estimate: BillEstimate | null;
  monthly: number | null;
  learning: boolean;
  canEdit: boolean;
}) {
  if (!estimate) {
    return (
      <div className="relative mt-8">
        <p className="text-sm text-white/80">Estimation sur 30 jours</p>
        <p className="tabular mt-2 text-5xl font-extrabold">{learning ? "–" : fcfa(monthly)}</p>
        <p className="mt-3 max-w-md text-sm text-white/85">
          Ajoute ta dernière facture CIE : on en tire ta période de facturation, la part fixe et le vrai prix du kWh, taxes comprises.
        </p>
        {canEdit && (
          <Link to={withQuery(R.historique, { facture: 1 })} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-bold text-brand-700">
            <Icon name="receipt" className="h-4 w-4" /> Ajouter ma dernière facture
          </Link>
        )}
      </div>
    );
  }
  const pct = Math.round(estimate.change * 100);
  const progress = Math.min(1, estimate.elapsedDays / estimate.periodDays);
  return (
    <div className="relative mt-6">
      <p className="text-sm text-white/80">Prochaine facture estimée</p>
      <p className="tabular mt-1 text-5xl font-extrabold">{fcfa(estimate.amountFcfa)}</p>
      <p className="mt-2 text-sm font-semibold text-white/90">
        {Math.abs(pct) < 3 ? "Comme ta dernière facture" : `${pct > 0 ? "+" : "−"}${Math.abs(pct)} % par rapport à ta dernière facture (${fcfa(estimate.lastAmountFcfa)})`}
      </p>
      <div className="mt-5">
        <div className="flex justify-between text-xs text-white/80">
          <span>Du {fmtDate(`${estimate.periodStart}T12:00:00Z`)}</span>
          <span>au {fmtDate(`${estimate.periodEnd}T12:00:00Z`)}</span>
        </div>
        <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-white/20" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-white" style={{ width: `${Math.max(4, progress * 100)}%` }} />
        </div>
        <p className="mt-2 text-sm text-white/90">
          {kwh(estimate.consumedKwh)} consommés en {Math.floor(estimate.elapsedDays)} jour{estimate.elapsedDays >= 2 ? "s" : ""}, {kwh(estimate.projectedKwh)} prévus sur la période.
        </p>
      </div>
      <p className="mt-3 text-xs text-white/75">{BASIS[estimate.basis]}{estimate.stale ? " Pense à ajouter tes dernières factures." : ""}</p>
    </div>
  );
}

/** Carte « Ta semaine ». */
export function WeeklyCard({ weekly }: { weekly: WeeklySummary | null }) {
  if (!weekly) return null;
  const up = (weekly.change ?? 0) > 0.03;
  const down = (weekly.change ?? 0) < -0.03;
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-bold">Ta semaine</h2>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${up ? "bg-red-50 text-red-700" : down ? "bg-emerald-50 text-emerald-700" : "bg-stone-100 text-stone-600"}`}>
          {weekly.change === null ? "Première semaine" : `${up ? "↑" : down ? "↓" : "="} ${Math.abs(Math.round(weekly.change * 100))} %`}
        </span>
      </div>
      <p className="tabular mt-3 text-3xl font-extrabold">{kwh(weekly.kwh)}</p>
      <p className="mt-1 text-sm text-stone-500 first-letter:uppercase">
        {weekly.change === null ? "Sur les 7 derniers jours. La comparaison arrive la semaine prochaine." : formatChange(weekly.change)}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl bg-stone-50 p-3">
          <p className="text-xs text-stone-500">Par jour</p>
          <p className="font-bold">{kwh(weekly.avgKwhDay)}</p>
        </div>
        <div className="rounded-xl bg-stone-50 p-3">
          <p className="text-xs text-stone-500">Recharges</p>
          <p className="font-bold">{fcfa(weekly.spendFcfa)}</p>
        </div>
      </div>
    </Card>
  );
}
