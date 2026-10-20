// Historique (BF-12) : consommation par jour sur 14 ou 30 jours, dépenses
// du mois, liste des relevés et recharges avec suppression.
import { dailyConsumption } from "@shared/prevision.ts";
import { PAYMENT_LABELS } from "@shared/validation.ts";
import { localParts } from "@shared/temps.ts";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BarChart } from "@/components/BarChart";
import { BillsSection } from "@/components/Factures";
import { MeterPicker } from "@/components/MeterPicker";
import { Button, Card, Notice, PageTitle, Sheet, useToast } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useData, useForecast } from "@/lib/data";
import { fcfa, fmtDate, fmtDateTime, kwh } from "@/lib/format";
import { errorMessage, supabase } from "@/lib/supabase";
import { R, withQuery } from "@/lib/routes";

type Item =
  | { kind: "releve"; id: string; by: string; at: string; value: number; source: string }
  | { kind: "recharge"; id: string; by: string; at: string; kwh: number; amount: number; code: string | null; method: string | null };

export default function Historique() {
  const { profile } = useAuth();
  const { selectedMeter, currentPlan, afterChange, access, subscription } = useData();
  const { forecast, history } = useForecast(selectedMeter);
  const toast = useToast();
  const [days, setDays] = useState<14 | 30>(14);
  const [deleting, setDeleting] = useState<Item | null>(null);
  const [busy, setBusy] = useState(false);
  const limitDays = currentPlan?.history_days ?? null;

  const bars = useMemo(() => {
    if (!forecast) return [];
    return dailyConsumption(forecast.segments, days, new Date()).map((d) => ({
      label: String(Number(d.date.slice(8, 10))),
      title: fmtDate(`${d.date}T12:00:00Z`),
      value: d.kwh,
    }));
  }, [forecast, days]);

  const monthKey = localParts(new Date()).date.slice(0, 7);
  const monthSpend = (history?.recharges ?? [])
    .filter((r) => localParts(new Date(r.purchased_at)).date.startsWith(monthKey))
    .reduce((s, r) => s + r.amount_fcfa, 0);

  const items = useMemo<Item[]>(() => {
    const since = limitDays ? Date.now() - limitDays * 86_400_000 : 0;
    const list: Item[] = [
      ...(history?.readings ?? []).map((r) => ({ kind: "releve" as const, id: r.id, by: r.user_id, at: r.taken_at, value: r.value, source: r.source })),
      ...(history?.recharges ?? []).map((r) => ({
        kind: "recharge" as const, id: r.id, by: r.user_id, at: r.purchased_at, kwh: r.kwh, amount: r.amount_fcfa, code: r.code, method: r.payment_method,
      })),
    ];
    return list.filter((i) => new Date(i.at).getTime() >= since).sort((a, b) => b.at.localeCompare(a.at));
  }, [history, limitDays]);

  async function remove(item: Item) {
    if (!selectedMeter) return;
    setBusy(true);
    const { error } = await supabase.from(item.kind === "releve" ? "readings" : "recharges").delete().eq("id", item.id);
    setBusy(false);
    setDeleting(null);
    if (error) return toast(errorMessage(error), "error");
    await afterChange(selectedMeter.id);
    toast(item.kind === "releve" ? "Relevé supprimé" : "Recharge supprimée");
  }

  if (!selectedMeter) return <Notice>Ajoute d'abord un compteur.</Notice>;

  return (
    <div className="space-y-4">
      <PageTitle>Historique</PageTitle>
      <MeterPicker />

      <div className="grid gap-4 lg:grid-cols-3">
      <Card className="p-5 lg:col-span-2">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Consommation par jour</h2>
          <div className="flex rounded-lg bg-stone-100 p-1 text-sm">
            {([14, 30] as const).map((d) => (
              <button key={d} onClick={() => setDays(d)} className={`rounded-md px-3 py-1 font-medium ${days === d ? "bg-white text-stone-900 shadow-sm" : "text-stone-500"}`}>
                {d} j
              </button>
            ))}
          </div>
        </div>
        <BarChart bars={bars} format={(v) => kwh(v)} emptyText="Les barres apparaîtront après deux relevés espacés de quelques heures." />
      </Card>

      <div className="grid content-start gap-4 sm:grid-cols-2 lg:grid-cols-1">
        {selectedMeter.kind === "prepaid" && (
          <Card className="bg-hero p-5 text-white ring-0">
            <p className="text-sm text-white/80">Dépenses du mois</p>
            <p className="tabular mt-1 text-3xl font-extrabold">{fcfa(monthSpend)}</p>
            <Link to={withQuery(R.recharge, { compteur: selectedMeter.id })} className="mt-4 inline-block rounded-xl bg-white px-4 py-2 text-sm font-bold text-brand-700">
              + Nouvelle recharge
            </Link>
          </Card>
        )}
        <Card className="p-5">
          <p className="text-sm text-stone-500">Consommé sur {days} jours</p>
          <p className="tabular mt-1 text-3xl font-extrabold">{kwh(bars.reduce((s, b) => s + (b.value ?? 0), 0))}</p>
          <p className="mt-1 text-sm text-stone-500">Moyenne pondérée : {kwh(forecast?.avgKwhDay ?? null)} par jour</p>
        </Card>
      </div>
      </div>

      {selectedMeter.kind === "postpaid" && (
        <BillsSection
          meter={selectedMeter}
          bills={history?.bills ?? []}
          canEdit={access(selectedMeter) !== "lecteur" && !subscription.readOnly}
          canDelete={(b) => b.user_id === profile?.id || access(selectedMeter) === "proprietaire"}
          onChange={() => afterChange(selectedMeter.id)}
        />
      )}

      <div>
        <h2 className="mb-2 font-semibold">Relevés et recharges</h2>
        {items.length === 0 ? (
          <p className="text-sm text-stone-500">Rien pour l'instant.</p>
        ) : (
          <ul className="divide-y divide-stone-200 overflow-hidden rounded-2xl bg-white ring-1 ring-stone-200">
            {items.map((i) => (
              <li key={`${i.kind}-${i.id}`} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  {i.kind === "releve" ? (
                    <p className="font-medium">
                      Relevé <span className="tabular">{kwh(i.value)}</span>
                      {i.source === "photo" && <span className="ml-2 rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-500">photo</span>}
                    </p>
                  ) : (
                    <p className="font-medium text-emerald-700">
                      Recharge <span className="tabular">+{kwh(i.kwh)}</span>
                      {i.amount > 0 && <span className="text-stone-600"> · {fcfa(i.amount)}</span>}
                    </p>
                  )}
                  <p className="truncate text-sm text-stone-500">
                    {fmtDateTime(i.at)}
                    {i.kind === "recharge" && i.method ? ` · ${PAYMENT_LABELS[i.method as keyof typeof PAYMENT_LABELS] ?? i.method}` : ""}
                    {i.kind === "recharge" && i.code ? ` · code ${i.code}` : ""}
                  </p>
                </div>
                {(i.by === profile?.id || access(selectedMeter) === "proprietaire") && <button onClick={() => setDeleting(i)} className="shrink-0 rounded-lg p-2 text-stone-400 hover:bg-red-50 hover:text-red-600" aria-label="Supprimer">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14" />
                  </svg>
                </button>}
              </li>
            ))}
          </ul>
        )}
        {limitDays && (
          <p className="mt-3 text-sm text-stone-500">
            Offre gratuite : {limitDays} derniers jours affichés. <Link to={R.offres} className="font-medium text-brand-700">Historique illimité</Link>
          </p>
        )}
      </div>

      <Sheet open={!!deleting} onClose={() => setDeleting(null)} title="Supprimer cette ligne ?">
        {deleting && (
          <div className="space-y-3">
            <p className="text-stone-700">La prévision sera recalculée sans elle.</p>
            <Button variant="danger" className="w-full" loading={busy} onClick={() => void remove(deleting)}>Supprimer</Button>
            <Button variant="ghost" className="w-full" onClick={() => setDeleting(null)}>Annuler</Button>
          </div>
        )}
      </Sheet>
    </div>
  );
}
