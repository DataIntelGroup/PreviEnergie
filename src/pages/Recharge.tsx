// Recharge prépayée : reçu (photo, capture, PDF) ou SMS lu sur le téléphone,
// sans IA payante, ou saisie à la main (BF-07).
import type { ReceiptRead } from "@shared/lecture-recu.ts";
import { currentCycleKey } from "@shared/prevision.ts";
import { PAYMENT_LABELS, PAYMENT_METHODS, type PaymentMethod } from "@shared/validation.ts";
import { type FormEvent, useEffect, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { CutoffQuestion } from "@/components/CutoffQuestion";
import { AccessBanner } from "@/components/AccessBanner";
import { MeterPicker } from "@/components/MeterPicker";
import { type DocumentResult, LectureDocument } from "@/components/LectureDocument";
import { Button, Card, Field, Input, Notice, PageTitle, Select, Sheet, useToast } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { toEngine, useData } from "@/lib/data";
import { fcfa, fromLocalInput, toLocalInput } from "@/lib/format";
import type { CompressedPhoto } from "@/lib/photo";
import { errorMessage, supabase } from "@/lib/supabase";
import { R, withQuery } from "@/lib/routes";

const LEVEL_TYPES = ["niveau_j5", "niveau_j2", "veille", "veille_rappel"];
const toNumber = (s: string) => Number(s.replace(",", ".").replace(/\s/g, ""));

export default function Recharge() {
  const { profile } = useAuth();
  const { meters, selectedMeter, selectMeter, history, loadHistory, afterChange, access, subscription } = useData();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const meter = selectedMeter;
  const [step, setStep] = useState<"photo" | "form">("photo");
  const [photo, setPhoto] = useState<CompressedPhoto | null>(null);
  const [doc, setDoc] = useState<DocumentResult | null>(null);
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
  if (subscription.readOnly) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageTitle>Nouvelle recharge</PageTitle>
        <AccessBanner />
      </div>
    );
  }
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

  function onRead(d: DocumentResult) {
    setDoc(d);
    setPhoto(d.photo);
    setStep("form");
    const r = d.receipt;
    if (!r || r.found === 0) {
      setNote("Je n'ai trouvé aucun chiffre utile sur ce document. Complète les champs.");
      return;
    }
    if (r.kwh !== null) setKwh(String(r.kwh).replace(".", ","));
    if (r.amountFcfa !== null) setAmount(String(Math.round(r.amountFcfa)));
    if (r.code) setCode(r.code);
    if ((PAYMENT_METHODS as readonly string[]).includes(r.source)) setMethod(r.source as PaymentMethod);
    if (r.date && Date.parse(r.date) <= Date.now()) setAt(toLocalInput(new Date(r.date)));
    if (r.kind === "paiement_facture") {
      setNote("Ce reçu est le paiement d'une facture postpayée, pas un achat de kWh. Enregistre-le plutôt dans les factures d'un compteur postpayé.");
    } else if (r.consistent) {
      setNote("Reçu lu et montant vérifié : le détail tombe juste. Vérifie quand même puis confirme.");
    } else {
      setNote(r.found >= 3 ? "Reçu lu. Vérifie les champs puis confirme." : "Lecture partielle : complète les champs manquants.");
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
        source: doc?.method === "texte" ? "sms" : doc ? "photo" : "manuel",
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
        <Card>
          <LectureDocument kind="recu" onResult={onRead} onManual={() => setStep("form")} />
        </Card>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
          {note && <Notice tone={doc?.receipt?.consistent && doc.receipt.kind !== "paiement_facture" ? "success" : "warning"}>{note}</Notice>}
          {doc?.receipt && <Detail r={doc.receipt} />}
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
          {doc && (
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => {
                setDoc(null);
                setPhoto(null);
                setNote(null);
                setStep("photo");
              }}
            >
              Lire un autre document
            </Button>
          )}
          <p className="text-center text-sm text-stone-500">Pense à faire un relevé après avoir saisi le code dans le compteur.</p>
        </form>
      )}

      <Sheet open={!!askCut} onClose={() => navigate(R.app, { replace: true })} title="Une question rapide">
        {askCut && <CutoffQuestion meterId={meter.id} cycleKey={askCut} question="As-tu été coupé avant cette recharge ?" onDone={() => navigate(R.app, { replace: true })} />}
      </Sheet>
    </div>
  );
}

/** Détail lu sur un reçu CIE : ce que paie vraiment chaque kWh. */
function Detail({ r }: { r: ReceiptRead }) {
  const b = r.breakdown;
  const rows: [string, number | null][] = [
    ["Énergie", b.energie],
    ["Prime fixe", b.primeFixe],
    ["Redevance RTI", b.rti],
    ["Électrification rurale", b.rer],
    ["Ordures ménagères", b.teom],
    ["Dette reprise", b.dette],
    ["Redevance de branchement", b.branchement],
  ];
  const shown = rows.filter(([, v]) => v !== null && v > 0);
  if (shown.length < 2) return null;
  // Le prix du kWh ne compte pas ce qui rembourse une dette ou le branchement.
  const energyPaid = r.amountFcfa === null ? null : r.amountFcfa - (b.dette ?? 0) - (b.branchement ?? 0);
  const perKwh = energyPaid && r.kwh ? energyPaid / r.kwh : null;
  return (
    <Card className="space-y-2 text-sm">
      <p className="font-semibold text-stone-900">Détail du reçu</p>
      <dl className="divide-y divide-stone-100">
        {shown.map(([label, v]) => (
          <div key={label} className="flex justify-between py-1.5">
            <dt className="text-stone-600">{label}</dt>
            <dd className="tabular font-medium">{fcfa(v)}</dd>
          </div>
        ))}
        {b.tva !== null && (
          <div className="flex justify-between py-1.5 text-stone-500">
            <dt>dont TVA</dt>
            <dd className="tabular">{fcfa(b.tva)}</dd>
          </div>
        )}
        <div className="flex justify-between py-1.5 font-semibold">
          <dt>Total payé {r.consistent && <span className="text-emerald-600">✓</span>}</dt>
          <dd className="tabular">{fcfa(r.amountFcfa)}</dd>
        </div>
      </dl>
      {perKwh && (
        <p className="text-stone-500">
          Prix réel : {fcfa(perKwh)} par kWh, taxes comprises{b.branchement || b.dette ? ", hors redevance et dette" : ""}.
        </p>
      )}
    </Card>
  );
}
