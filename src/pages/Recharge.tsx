// Recharge prépayée : photo du reçu ou du SMS lue par l'IA, ou saisie (BF-07).
import { currentCycleKey } from "@shared/prevision.ts";
import { PAYMENT_LABELS, PAYMENT_METHODS, type PaymentMethod } from "@shared/validation.ts";
import { type FormEvent, useEffect, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { CutoffQuestion } from "@/components/CutoffQuestion";
import { MeterPicker } from "@/components/MeterPicker";
import { PhotoCapture, type ReadResponse } from "@/components/PhotoCapture";
import { Button, Card, Field, Input, Notice, PageTitle, Select, Sheet, useToast } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { toEngine, useData } from "@/lib/data";
import { fromLocalInput, toLocalInput } from "@/lib/format";
import type { CompressedPhoto } from "@/lib/photo";
import { errorMessage, supabase } from "@/lib/supabase";
import { R, withQuery } from "@/lib/routes";

interface ReceiptRead {
  lisible: boolean;
  kwh: number | null;
  montant_fcfa: number | null;
  code: string | null;
  moyen_paiement: PaymentMethod | null;
  date: string | null;
  confiance: number;
  remarque: string;
}

const TIPS = ["Reçu papier, capture du SMS de confirmation ou de l'application de paiement.", "Le code et les kWh doivent être bien lisibles."];
const LEVEL_TYPES = ["niveau_j5", "niveau_j2", "veille", "veille_rappel"];
const toNumber = (s: string) => Number(s.replace(",", ".").replace(/\s/g, ""));

export default function Recharge() {
  const { profile } = useAuth();
  const { meters, selectedMeter, selectMeter, history, loadHistory, afterChange, access } = useData();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const meter = selectedMeter;
  const [step, setStep] = useState<"photo" | "form">("photo");
  const [photo, setPhoto] = useState<CompressedPhoto | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [kwhValue, setKwh] = useState("");
  const [amount, setAmount] = useState("");
  const [code, setCode] = useState("");
  const [method, setMethod] = useState<PaymentMethod | "">("");
  const [at, setAt] = useState(() => toLocalInput(new Date()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askCut, setAskCut] = useState<string | null>(null);

  useEffect(() => {
    const id = params.get("compteur");
    if (id && meters.some((m) => m.id === id)) selectMeter(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (meter) void loadHistory(meter.id).catch(console.error);
  }, [meter?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (meters.length === 0) return <Navigate to={withQuery(R.compteurs, { premier: 1 })} replace />;
  if (!meter || !profile) return null;
  if (access(meter) === "lecteur") {
    return (
      <div className="mx-auto max-w-2xl">
        <PageTitle>Nouvelle recharge</PageTitle>
        <MeterPicker />
        <Notice className="mt-4">« {meter.name} » t'est partagé en lecture seule : seul son propriétaire, ou un contributeur, peut y ajouter des données.</Notice>
      </div>
    );
  }
  if (meter.kind === "postpaid") {
    return (
      <div>
        <PageTitle>Recharge</PageTitle>
        <MeterPicker />
        <Notice>« {meter.name} » est un compteur postpayé : pas de recharge à enregistrer, seulement des relevés d'index.</Notice>
      </div>
    );
  }

  function onRead(p: CompressedPhoto, read: ReadResponse<ReceiptRead>) {
    setPhoto(p);
    setStep("form");
    const r = read.result;
    if (r && (r.kwh !== null || r.montant_fcfa !== null)) {
      if (r.kwh !== null) setKwh(String(r.kwh).replace(".", ","));
      if (r.montant_fcfa !== null) setAmount(String(Math.round(r.montant_fcfa)));
      if (r.code) setCode(r.code);
      if (r.moyen_paiement) setMethod(r.moyen_paiement);
      if (r.date && !Number.isNaN(Date.parse(r.date)) && Date.parse(r.date) <= Date.now()) setAt(toLocalInput(new Date(r.date)));
      setNote(r.confiance < 0.7 ? "Lecture incertaine : vérifie chaque champ." : "Informations lues sur la photo. Vérifie-les puis confirme.");
    } else {
      setNote(r?.remarque || read.message || "Je n'ai pas réussi à lire le reçu. Complète les champs.");
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!meter || !profile) return;
    const k = toNumber(kwhValue);
    const a = amount.trim() ? toNumber(amount) : 0;
    if (!Number.isFinite(k) || k <= 0) return setError("Indique le nombre de kWh achetés.");
    if (!Number.isFinite(a) || a < 0) return setError("Montant invalide.");
    setBusy(true);
    setError(null);
    const previousCycle = currentCycleKey(toEngine(history(meter.id)).recharges);
    try {
      let photoPath: string | null = null;
      if (photo) {
        photoPath = `${profile.id}/${meter.id}/recu-${Date.now()}.jpg`;
        const up = await supabase.storage.from("photos").upload(photoPath, photo.blob, { contentType: "image/jpeg" });
        if (up.error) photoPath = null;
      }
      const { error } = await supabase.from("recharges").insert({
        meter_id: meter.id,
        purchased_at: fromLocalInput(at),
        kwh: k,
        amount_fcfa: Math.round(a),
        code: code.trim() || null,
        payment_method: method || null,
        source: photo ? "photo" : "manuel",
        photo_path: photoPath,
      });
      if (error) throw error;
      await afterChange(meter.id);
      toast("Recharge enregistrée");

      // Une alerte de niveau était partie sur le cycle précédent : la recharge
      // a-t-elle évité la coupure ? (BF-13)
      const [{ data: alerts }, { data: fb }] = await Promise.all([
        supabase.from("alerts").select("id").eq("meter_id", meter.id).eq("cycle_key", previousCycle).in("type", LEVEL_TYPES).limit(1),
        supabase.from("cutoff_feedback").select("id").eq("meter_id", meter.id).eq("cycle_key", previousCycle).limit(1),
      ]);
      if (alerts?.length && !fb?.length) setAskCut(previousCycle);
      else navigate(R.app, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle>Nouvelle recharge</PageTitle>
      <MeterPicker />
      {step === "photo" ? (
        <Card className="space-y-4">
          <PhotoCapture<ReceiptRead> kind="recu" meterKind={meter.kind} label="Photographier le reçu" tips={TIPS} onRead={onRead} />
          <Button variant="secondary" className="w-full" onClick={() => setStep("form")}>Saisir à la main</Button>
        </Card>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
          {note && <Notice tone={note.startsWith("Informations") ? "success" : "warning"}>{note}</Notice>}
          <Card className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="kWh achetés">
                {(id) => <Input id={id} inputMode="decimal" className="tabular text-lg font-semibold" value={kwhValue} onChange={(e) => setKwh(e.target.value)} />}
              </Field>
              <Field label="Montant (FCFA)">
                {(id) => <Input id={id} inputMode="numeric" className="tabular text-lg font-semibold" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />}
              </Field>
            </div>
            <Field label="Code de recharge" hint="Gardé dans ton historique, pour ne plus le perdre.">
              {(id) => <Input id={id} className="tabular" value={code} maxLength={40} onChange={(e) => setCode(e.target.value)} />}
            </Field>
            <Field label="Payé avec">
              {(id) => (
                <Select id={id} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                  <option value="">Choisir…</option>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Date et heure de l'achat">
              {(id) => <Input id={id} type="datetime-local" value={at} max={toLocalInput(new Date())} onChange={(e) => setAt(e.target.value)} />}
            </Field>
          </Card>
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" loading={busy} className="w-full">Enregistrer la recharge</Button>
          <p className="text-center text-sm text-stone-500">Pense à faire un relevé après avoir saisi le code dans le compteur.</p>
        </form>
      )}

      <Sheet open={!!askCut} onClose={() => navigate(R.app, { replace: true })} title="Une question rapide">
        {askCut && <CutoffQuestion meterId={meter.id} cycleKey={askCut} question="As-tu été coupé avant cette recharge ?" onDone={() => navigate(R.app, { replace: true })} />}
      </Sheet>
    </div>
  );
}
