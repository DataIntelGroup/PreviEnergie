// Quatre tableaux de bord sur 7, 30 ou 90 jours (BF-26 à BF-29), tous
// alimentés par un seul appel à admin_dashboard.
import { ALERT_LABELS, type AlertType, CHANNEL_LABELS, type Channel } from "@shared/reglages.ts";
import { PAYMENT_LABELS } from "@shared/validation.ts";
import type { ReactNode } from "react";
import { BarChart } from "@/components/BarChart";
import { Card, Notice, Spinner } from "@/components/ui";
import { fcfa, fmtDate, fmtDateTime, num, pct } from "@/lib/format";
import { useAdmin } from "./AdminApp";

interface Item {
  label: string;
  value: number;
  amount?: number;
  count?: number;
}
interface Point {
  date: string;
  value: number;
}

export interface Dashboard {
  days: number;
  generatedAt: string;
  signups: {
    total: number; new: number; active: number; complete: number;
    byCommune: Item[]; bySource: Item[]; byPlan: Item[]; byMeterKind: Item[]; series: Point[];
  };
  finance: {
    mrr: number; collected: number; paymentsCount: number; refusedCount: number; paying: number; conversion: number;
    byMethod: Item[]; byPlan: Item[]; series: Point[];
    recent: { id: string; created_at: string; amount: number; plan: string; status: string; method: string | null; name: string; phone: string | null }[];
  };
  costs: {
    byChannel: Item[]; ai: { count: number; cost: number }; total: number; perActiveUser: number;
    marginByPlan: { plan: string; name: string; revenue: number; cost: number; margin: number }[];
  };
  activity: {
    readings: number; readingsBySource: Item[]; recharges: number; aiReads: number; aiSuccessRate: number;
    retention7: number; retention30: number; alertsByChannel: Item[]; alertsByType: Item[]; alertsFailed: number;
    avoidedCutoffs: number; reportedCutoffs: number; series: Point[];
  };
}

const PLAN_NAMES: Record<string, string> = { gratuit: "Gratuit", essentiel: "Essentiel", famille_pro: "Famille / Pro", entreprise: "Entreprise" };
const KIND_NAMES: Record<string, string> = { prepaid: "Prépayé", postpaid: "Postpayé" };
const SOURCE_NAMES: Record<string, string> = { photo: "Photo", manuel: "Saisie" };

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <p className="text-sm text-stone-500">{label}</p>
      <p className="tabular mt-1 text-3xl font-bold text-stone-900">{value}</p>
      {sub && <p className="mt-1 text-xs text-stone-500">{sub}</p>}
    </Card>
  );
}

/** Répartition en barres horizontales, valeur écrite à côté de chaque barre. */
function Breakdown({ title, items, format = (v) => num(v, 0), label = (l) => l }: {
  title: string;
  items: Item[];
  format?: (v: number, item: Item) => string;
  label?: (l: string) => string;
}) {
  const max = Math.max(...items.map((i) => i.value), 0);
  return (
    <Card>
      <h3 className="mb-3 font-semibold">{title}</h3>
      {items.length === 0 || max === 0 ? (
        <p className="text-sm text-stone-500">Aucune donnée sur la période.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((i) => (
            <li key={i.label} className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-3 text-sm" title={`${label(i.label)} : ${format(i.value, i)}`}>
              <span className="truncate text-stone-700">{label(i.label)}</span>
              <span className="h-3 rounded-r bg-stone-100">
                <span className="block h-3 rounded-r bg-brand-600" style={{ width: `${Math.max(2, (i.value / max) * 100)}%` }} />
              </span>
              <span className="tabular text-right font-medium text-stone-900">{format(i.value, i)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Series({ title, points, format }: { title: string; points: Point[]; format: (v: number) => string }) {
  return (
    <Card>
      <h3 className="mb-2 font-semibold">{title}</h3>
      <BarChart
        bars={points.map((p) => ({ label: fmtDate(`${p.date}T12:00:00Z`).replace(/\.$/, ""), title: fmtDate(`${p.date}T12:00:00Z`), value: Number(p.value) }))}
        format={format}
        emptyText="Aucune donnée sur la période."
      />
    </Card>
  );
}

function Frame({ title, children }: { title: string; children: (d: Dashboard) => ReactNode }) {
  const { days, setDays, data, loading, error, reload } = useAdmin();
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{title}</h1>
        <div className="flex items-center gap-3">
          {loading && <Spinner className="h-4 w-4 text-brand-600" />}
          <div className="flex rounded-lg bg-white p-1 text-sm ring-1 ring-stone-200" role="group" aria-label="Période">
            {[7, 30, 90].map((d) => (
              <button key={d} onClick={() => setDays(d)} className={`rounded-md px-3 py-1.5 font-medium ${days === d ? "bg-brand-600 text-white" : "text-stone-600"}`}>
                {d} jours
              </button>
            ))}
          </div>
          <button onClick={reload} className="text-sm font-medium text-brand-700">Actualiser</button>
        </div>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {data ? (
        <>
          {children(data)}
          <p className="text-xs text-stone-500">Mis à jour {fmtDateTime(data.generatedAt)} · actualisation automatique chaque minute.</p>
        </>
      ) : (
        !error && <div className="flex justify-center py-20 text-brand-600"><Spinner /></div>
      )}
    </div>
  );
}

export default function Dashboards({ view }: { view: "signups" | "finance" | "costs" | "activity" }) {
  if (view === "signups") {
    return (
      <Frame title="Inscriptions">
        {({ signups: s, days }) => (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile label="Inscrits" value={num(s.total, 0)} sub={`${num(s.complete, 0)} profil${s.complete > 1 ? "s" : ""} complet${s.complete > 1 ? "s" : ""}`} />
              <Tile label={`Nouveaux (${days} j)`} value={num(s.new, 0)} />
              <Tile label={`Actifs (${days} j)`} value={num(s.active, 0)} sub="au moins un relevé" />
              <Tile label="Taux d'activité" value={pct(s.total ? s.active / s.total : 0)} />
            </div>
            <Series title="Inscriptions par jour" points={s.series} format={(v) => `${num(v, 0)} inscription${v > 1 ? "s" : ""}`} />
            <div className="grid gap-3 lg:grid-cols-2">
              <Breakdown title="Par commune" items={s.byCommune} />
              <Breakdown title="Par source" items={s.bySource} />
              <Breakdown title="Par offre" items={s.byPlan} label={(l) => PLAN_NAMES[l] ?? l} />
              <Breakdown title="Compteurs par type" items={s.byMeterKind} label={(l) => KIND_NAMES[l] ?? l} />
            </div>
          </>
        )}
      </Frame>
    );
  }

  if (view === "finance") {
    return (
      <Frame title="Finances">
        {({ finance: f, days }) => (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile label="Revenu mensuel récurrent" value={fcfa(f.mrr)} sub="offres payantes en cours" />
              <Tile label={`Encaissé (${days} j)`} value={fcfa(f.collected)} sub={`${num(f.paymentsCount, 0)} paiements · ${num(f.refusedCount, 0)} refusés`} />
              <Tile label="Abonnés payants" value={num(f.paying, 0)} />
              <Tile label="Conversion" value={pct(f.conversion)} sub="payants / inscrits" />
            </div>
            <Series title="Encaissements par jour" points={f.series} format={(v) => fcfa(v)} />
            <div className="grid gap-3 lg:grid-cols-2">
              <Breakdown title="Moyens de paiement" items={f.byMethod} label={(l) => PAYMENT_LABELS[l as keyof typeof PAYMENT_LABELS] ?? l}
                format={(_, i) => `${fcfa(i.amount ?? 0)} · ${i.value}`} />
              <Breakdown title="Par offre" items={f.byPlan} label={(l) => PLAN_NAMES[l] ?? l} format={(_, i) => `${fcfa(i.amount ?? 0)} · ${i.value}`} />
            </div>
            <Card>
              <h3 className="mb-3 font-semibold">Derniers paiements</h3>
              {f.recent.length === 0 ? (
                <p className="text-sm text-stone-500">Aucun paiement pour l'instant.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-stone-500">
                      <tr><th className="py-2 pr-4 font-medium">Date</th><th className="pr-4 font-medium">Client</th><th className="pr-4 font-medium">Offre</th><th className="pr-4 font-medium">Moyen</th><th className="pr-4 text-right font-medium">Montant</th><th className="font-medium">Statut</th></tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {f.recent.map((p) => (
                        <tr key={p.id}>
                          <td className="py-2 pr-4 whitespace-nowrap">{fmtDateTime(p.created_at)}</td>
                          <td className="pr-4">{p.name || "Compte supprimé"}</td>
                          <td className="pr-4">{PLAN_NAMES[p.plan] ?? p.plan}</td>
                          <td className="pr-4">{p.method ? PAYMENT_LABELS[p.method as keyof typeof PAYMENT_LABELS] ?? p.method : "–"}</td>
                          <td className="tabular pr-4 text-right">{fcfa(p.amount)}</td>
                          <td className={p.status === "accepted" ? "text-emerald-700" : p.status === "refused" ? "text-red-600" : "text-stone-500"}>
                            {p.status === "accepted" ? "Payé" : p.status === "refused" ? "Refusé" : "En attente"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}
      </Frame>
    );
  }

  if (view === "costs") {
    return (
      <Frame title="Coûts et marge">
        {({ costs: c, days }) => (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile label={`Coûts totaux (${days} j)`} value={fcfa(c.total)} />
              <Tile label="Coût par utilisateur actif" value={fcfa(c.perActiveUser)} />
              <Tile label="Lecture IA" value={fcfa(c.ai.cost)} sub={`${num(c.ai.count, 0)} photos lues`} />
              <Tile label="Messages" value={fcfa(c.total - c.ai.cost)} sub="WhatsApp, SMS, email" />
            </div>
            <Breakdown title="Coût par canal" items={c.byChannel} label={(l) => CHANNEL_LABELS[l as Channel] ?? l}
              format={(v, i) => `${fcfa(v)} · ${num(i.count ?? 0, 0)} envois`} />
            <Card>
              <h3 className="mb-3 font-semibold">Marge par offre sur la période</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-stone-500">
                    <tr><th className="py-2 pr-4 font-medium">Offre</th><th className="pr-4 text-right font-medium">Revenus</th><th className="pr-4 text-right font-medium">Coûts</th><th className="text-right font-medium">Marge</th></tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {c.marginByPlan.map((m) => (
                      <tr key={m.plan}>
                        <td className="py-2 pr-4">{m.name}</td>
                        <td className="tabular pr-4 text-right">{fcfa(m.revenue)}</td>
                        <td className="tabular pr-4 text-right">{fcfa(m.cost)}</td>
                        <td className={`tabular text-right font-semibold ${m.margin < 0 ? "text-red-600" : "text-stone-900"}`}>{fcfa(m.margin)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-stone-500">Les coûts unitaires se règlent dans Réglages. L'offre gratuite n'utilise que des canaux gratuits, sa marge négative vient de la lecture IA.</p>
            </Card>
          </>
        )}
      </Frame>
    );
  }

  return (
    <Frame title="Activité">
      {({ activity: a, days }) => (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label={`Relevés (${days} j)`} value={num(a.readings, 0)} sub={`${num(a.recharges, 0)} recharges`} />
            <Tile label="Photos lues correctement" value={pct(a.aiSuccessRate)} sub={`${num(a.aiReads, 0)} lectures`} />
            <Tile label="Rétention" value={pct(a.retention7)} sub={`à 30 jours : ${pct(a.retention30)} (relevé dans les 7 derniers jours)`} />
            <Tile label="Coupures évitées" value={num(a.avoidedCutoffs, 0)} sub={`${num(a.reportedCutoffs, 0)} coupures signalées`} />
          </div>
          <Series title="Relevés par jour" points={a.series} format={(v) => `${num(v, 0)} relevé${v > 1 ? "s" : ""}`} />
          <div className="grid gap-3 lg:grid-cols-3">
            <Breakdown title="Alertes par canal" items={a.alertsByChannel} label={(l) => CHANNEL_LABELS[l as Channel] ?? l} />
            <Breakdown title="Alertes par type" items={a.alertsByType} label={(l) => ALERT_LABELS[l as AlertType] ?? l} />
            <Breakdown title="Relevés par mode" items={a.readingsBySource} label={(l) => SOURCE_NAMES[l] ?? l} />
          </div>
          {a.alertsFailed > 0 && <Notice tone="warning">{a.alertsFailed} alerte{a.alertsFailed > 1 ? "s" : ""} non délivrée{a.alertsFailed > 1 ? "s" : ""} sur la période (voir les secrets des canaux).</Notice>}
        </>
      )}
    </Frame>
  );
}
