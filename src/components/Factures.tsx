// Factures postpayées (BF-14) : photo ou PDF lu sur le téléphone, ou saisie,
// liste et suppression. Elles alimentent l'estimation de la prochaine facture.
import { billPricing } from "@shared/facture.ts";
import { type FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { fcfa, fmtDate, kwh, num } from "@/lib/format";
import type { CompressedPhoto } from "@/lib/photo";
import { errorMessage, supabase } from "@/lib/supabase";
import type { BillRow, Meter } from "@/lib/types";
import { toBill } from "./Facture";
import { Icon } from "./icons";
import { type DocumentResult, LectureDocument } from "./LectureDocument";
import { Button, Card, Field, Input, Notice, Sheet, useToast } from "./ui";

const numOrNull = (v: string) => {
  const n = Number(v.replace(",", ".").replace(/\s/g, ""));
  return v.trim() && Number.isFinite(n) ? n : null;
};
const str = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n).replace(".", ","));
const validDate = (d: string | null) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : "");

function BillForm({ meter, onDone }: { meter: Meter; onDone: () => void }) {
  const { profile } = useAuth();
  const toast = useToast();
  const [step, setStep] = useState<"photo" | "form">("photo");
  const [photo, setPhoto] = useState<CompressedPhoto | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [f, setF] = useState({ start: "", end: "", indexStart: "", indexEnd: "", kwh: "", amount: "", fixed: "", due: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  // La consommation se déduit des index quand les deux sont saisis.
  const iS = numOrNull(f.indexStart);
  const iE = numOrNull(f.indexEnd);
  useEffect(() => {
    if (iS !== null && iE !== null && iE >= iS) setF((x) => ({ ...x, kwh: str(Math.round((iE - iS) * 100) / 100) }));
  }, [iS, iE]);

  function onRead(d: DocumentResult) {
    setPhoto(d.photo);
    setStep("form");
    const r = d.bill;
    if (!r || r.found === 0) {
      setNote("Je n'ai pas réussi à lire la facture. Complète les champs.");
      return;
    }
    setF({
      start: validDate(r.periodStart),
      end: validDate(r.periodEnd),
      indexStart: str(r.indexStart),
      indexEnd: str(r.indexEnd),
      kwh: str(r.kwh),
      amount: str(r.amountFcfa),
      fixed: r.fixedFcfa ? String(Math.round(r.fixedFcfa)) : "",
      due: validDate(r.dueDate),
    });
    setNote(
      r.found >= 4 && r.indexConsistent !== false
        ? `Facture lue${r.indexConsistent ? ", index vérifiés" : ""}. Vérifie les champs puis enregistre.`
        : "Lecture partielle : complète les champs manquants.",
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const k = numOrNull(f.kwh);
    const amount = numOrNull(f.amount);
    const fixed = numOrNull(f.fixed);
    if (!f.start || !f.end || f.end <= f.start) return setError("Indique la période de consommation (du … au …).");
    if (!k || k <= 0) return setError("Indique la consommation en kWh.");
    if (!amount || amount <= 0) return setError("Indique le total de la facture.");
    if (fixed !== null && fixed >= amount) return setError("La part fixe doit être inférieure au total.");
    if (iS !== null && iE !== null && iE < iS) return setError("Le nouvel index ne peut pas être plus petit que l'ancien.");
    setBusy(true);
    setError(null);
    try {
      let photoPath: string | null = null;
      if (photo && profile) {
        photoPath = `${profile.id}/${meter.id}/facture-${Date.now()}.jpg`;
        const up = await supabase.storage.from("photos").upload(photoPath, photo.blob, { contentType: "image/jpeg" });
        if (up.error) photoPath = null;
      }
      const { error } = await supabase.from("bills").insert({
        meter_id: meter.id,
        period_start: f.start,
        period_end: f.end,
        index_start: iS,
        index_end: iE,
        kwh: k,
        amount_fcfa: Math.round(amount),
        fixed_fcfa: fixed === null ? null : Math.round(fixed),
        due_date: f.due || null,
        source: photo ? "photo" : "manuel",
        photo_path: photoPath,
      });
      if (error) throw error;
      toast("Facture enregistrée");
      onDone();
    } catch (err) {
      setError(errorMessage(err).includes("bills_meter_id_period_end_key") ? "Cette facture est déjà enregistrée." : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (step === "photo") {
    return (
      <LectureDocument kind="facture" onResult={onRead} onManual={() => setStep("form")} />
    );
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
      {note && <Notice tone={note.startsWith("Facture lue") ? "success" : "warning"}>{note}</Notice>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Consommation du">{(id) => <Input id={id} type="date" value={f.start} onChange={set("start")} />}</Field>
        <Field label="au">{(id) => <Input id={id} type="date" value={f.end} onChange={set("end")} />}</Field>
        <Field label="Ancien index">{(id) => <Input id={id} inputMode="decimal" value={f.indexStart} onChange={set("indexStart")} />}</Field>
        <Field label="Nouvel index">{(id) => <Input id={id} inputMode="decimal" value={f.indexEnd} onChange={set("indexEnd")} />}</Field>
        <Field label="Consommation (kWh)">{(id) => <Input id={id} inputMode="decimal" value={f.kwh} onChange={set("kwh")} />}</Field>
        <Field label="Total facture (FCFA)">{(id) => <Input id={id} inputMode="numeric" value={f.amount} onChange={set("amount")} />}</Field>
      </div>
      <Field label="Part fixe (FCFA, facultatif)" hint="Prime fixe TTC + autres taxes (électrification rurale, ordures ménagères, RTI, timbre). Rend l'estimation plus juste.">
        {(id) => <Input id={id} inputMode="numeric" value={f.fixed} onChange={set("fixed")} />}
      </Field>
      <Field label="Date limite de paiement (facultatif)">{(id) => <Input id={id} type="date" value={f.due} onChange={set("due")} />}</Field>
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" loading={busy} className="w-full">Enregistrer la facture</Button>
    </form>
  );
}

export function BillsSection({ meter, bills, canEdit, canDelete, onChange }: {
  meter: Meter;
  bills: BillRow[];
  canEdit: boolean;
  canDelete: (b: BillRow) => boolean;
  onChange: () => Promise<void>;
}) {
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(params.get("facture") === "1" && canEdit);
  const toast = useToast();

  async function remove(b: BillRow) {
    const { error } = await supabase.from("bills").delete().eq("id", b.id);
    if (error) return toast(errorMessage(error), "error");
    await onChange();
    toast("Facture supprimée");
  }

  const close = () => {
    setAdding(false);
    if (params.has("facture")) setParams({}, { replace: true });
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold">Mes factures</h2>
        {canEdit && (
          <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-800 hover:bg-brand-100">
            <Icon name="plus" className="h-4 w-4" /> Ajouter une facture
          </button>
        )}
      </div>
      {bills.length === 0 ? (
        <Card className="p-5 text-sm text-stone-600">Aucune facture. Ajoute la dernière pour obtenir une estimation précise de la prochaine.</Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {bills.map((b) => {
            const p = billPricing(toBill(b));
            return (
              <li key={b.id}>
                <Card className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{fmtDate(`${b.period_start}T12:00:00Z`)} → {fmtDate(`${b.period_end}T12:00:00Z`)}</p>
                      <p className="tabular text-2xl font-extrabold">{fcfa(b.amount_fcfa)}</p>
                    </div>
                    {canDelete(b) && (
                      <button onClick={() => void remove(b)} className="rounded-lg p-2 text-stone-400 hover:bg-red-50 hover:text-red-600" aria-label="Supprimer la facture">
                        <Icon name="x" className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-stone-500">
                    {kwh(b.kwh)} · {num(p.priceKwh, 0)} FCFA / kWh{b.fixed_fcfa !== null ? ` · part fixe ${fcfa(b.fixed_fcfa)}` : ""}
                  </p>
                  {b.due_date && <p className="mt-1 text-xs text-stone-500">À payer avant le {fmtDate(`${b.due_date}T12:00:00Z`)}</p>}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      <Sheet open={adding} onClose={close} title="Nouvelle facture">
        <BillForm meter={meter} onDone={() => { close(); void onChange(); }} />
      </Sheet>
    </div>
  );
}
