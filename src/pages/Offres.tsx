// Offres mensuelles sans engagement (BF-22). Paiement manuel : le client
// envoie le montant sur un de nos numéros (Wave, Orange Money, MTN MoMo,
// Moov Money), puis déclare l'identifiant de la transaction reçu par SMS.
// L'équipe vérifie et active l'offre (back-office, « À traiter »).
import { CHANNEL_LABELS } from "@shared/reglages.ts";
import { formatPhone, isValidPhone, isValidReference, type ManualMethod, MANUAL_METHODS, normalizePhone, PAYMENT_LABELS } from "@shared/validation.ts";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { AccessBanner } from "@/components/AccessBanner";
import { Button, Card, Field, Input, Notice, PageTitle } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useData } from "@/lib/data";
import { fcfa, fmtDate, fmtDateLong } from "@/lib/format";
import { callFunction, errorMessage, supabase } from "@/lib/supabase";
import { effectivePlanCode, type PaymentRow, type Plan } from "@/lib/types";

const STATUS = { pending: "En vérification", accepted: "Validé", refused: "Refusé" } as const;

/** Couleur de marque de chaque moyen, pour les reconnaître d'un coup d'œil. */
const METHOD_STYLE: Record<ManualMethod, string> = {
  wave: "bg-sky-500",
  orange_money: "bg-orange-500",
  mtn_momo: "bg-yellow-400 text-stone-900",
  moov_money: "bg-blue-700",
};

export default function Offres() {
  const { profile, refreshProfile } = useAuth();
  const { plans, settings, refreshMeters } = useData();
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [chosen, setChosen] = useState<Plan | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const hadPending = useRef(false);

  const loadPayments = () =>
    supabase.from("payments").select("*").eq("user_id", profile!.id).order("created_at", { ascending: false }).limit(10)
      .then(({ data }) => {
        const rows = (data as PaymentRow[]) ?? [];
        setPayments(rows);
        // Un paiement vient d'être traité par l'équipe : l'offre a peut-être changé.
        const pendingNow = rows.some((p) => p.status === "pending");
        if (hadPending.current && !pendingNow) {
          setDone(null);
          void refreshProfile();
          void refreshMeters();
        }
        hadPending.current = pendingNow;
      });

  useEffect(() => {
    void loadPayments();
    // Un paiement en vérification : on regarde de temps en temps s'il est validé.
    const t = setInterval(() => void loadPayments(), 60_000);
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!profile) return null;
  const current = effectivePlanCode(profile);
  const methods = MANUAL_METHODS.filter((m) => settings.manualPayment.numbers[m]);
  const pending = payments.filter((p) => p.status === "pending");

  return (
    <div className="space-y-4">
      <PageTitle>Offres</PageTitle>
      <p className="text-stone-600">
        Sans engagement, 30 jours par paiement{methods.length ? `, par ${methods.map((m) => PAYMENT_LABELS[m]).join(", ")}` : ""}.
        Ton offre est activée en moins de {settings.manualPayment.delayMinutes} minutes après ton paiement.
      </p>
      <AccessBanner />

      {done && <Notice tone="success">{done}</Notice>}
      {pending.length > 0 && !done && (
        <Notice>
          Paiement en vérification : ton offre sera activée en moins de {settings.manualPayment.delayMinutes} minutes. Tu recevras une notification.
        </Notice>
      )}

      {current !== "gratuit" && profile.plan_expires_at && (
        <Card className="bg-brand-50 ring-brand-200">
          <p className="text-sm text-brand-800">
            Offre <strong>{plans.find((p) => p.code === current)?.name}</strong> active jusqu'au {fmtDateLong(profile.plan_expires_at)}.
            Payer à nouveau prolonge de 30 jours à partir de cette date.
          </p>
        </Card>
      )}

      {chosen ? (
        <PayForm
          plan={chosen}
          methods={methods}
          defaultPhone={profile.phone ?? ""}
          onCancel={() => setChosen(null)}
          onDone={(msg) => {
            setChosen(null);
            setDone(msg);
            void loadPayments();
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {/* L'essai gratuit n'est pas une offre à choisir : il est donné à l'inscription. */}
          {plans.filter((p) => p.active && p.price_fcfa > 0).map((p) => {
            const isCurrent = p.code === current;
            return (
              <Card key={p.code} className={isCurrent ? "ring-2 ring-brand-500" : ""}>
                <div className="flex items-baseline justify-between">
                  <h2 className="text-lg font-bold">{p.name}</h2>
                  <p className="tabular text-lg font-bold text-brand-700">
                    {fcfa(p.price_fcfa)}
                    <span className="text-sm font-normal text-stone-500"> / mois</span>
                  </p>
                </div>
                <ul className="mt-2 space-y-1 text-sm text-stone-700">
                  <li>✓ {p.max_meters} compteur{p.max_meters > 1 ? "s" : ""}</li>
                  <li>✓ Alertes : {p.channels.map((c) => CHANNEL_LABELS[c]).join(", ")}</li>
                  <li>✓ Historique {p.history_days ? `de ${p.history_days} jours` : "illimité"}</li>
                </ul>
                <Button className="mt-4 w-full" variant={isCurrent ? "secondary" : "primary"} disabled={!methods.length}
                  onClick={() => { setDone(null); setChosen(p); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                  {isCurrent ? "Prolonger de 30 jours" : `Choisir ${p.name}`}
                </Button>
              </Card>
            );
          })}
        </div>
      )}
      {!methods.length && <Notice tone="warning">Le paiement n'est pas encore ouvert. Reviens un peu plus tard.</Notice>}

      {payments.length > 0 && (
        <div>
          <h2 className="mb-2 font-semibold">Mes paiements</h2>
          <ul className="divide-y divide-stone-200 overflow-hidden rounded-2xl bg-white ring-1 ring-stone-200">
            {payments.map((p) => (
              <li key={p.id} className="px-4 py-3 text-sm">
                <div className="flex justify-between gap-3">
                  <span>
                    {plans.find((x) => x.code === p.plan_code)?.name ?? p.plan_code} · {fmtDate(p.created_at)}
                    {p.reference && <span className="text-stone-500"> · réf. {p.reference}</span>}
                  </span>
                  <span className={`shrink-0 ${p.status === "accepted" ? "text-emerald-700" : p.status === "refused" ? "text-red-600" : "text-stone-500"}`}>
                    {fcfa(p.declared_amount ?? p.amount_fcfa)} · {STATUS[p.status]}
                  </span>
                </div>
                {p.status === "refused" && p.refusal_reason && <p className="mt-1 text-red-700">{p.refusal_reason}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function PayForm({ plan, methods, defaultPhone, onCancel, onDone }: {
  plan: Plan; methods: ManualMethod[]; defaultPhone: string; onCancel: () => void; onDone: (message: string) => void;
}) {
  const { settings } = useData();
  const [method, setMethod] = useState<ManualMethod>(methods[0]);
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState(String(plan.price_fcfa));
  const [payerPhone, setPayerPhone] = useState(defaultPhone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const number = settings.manualPayment.numbers[method];

  async function copy() {
    try {
      await navigator.clipboard.writeText(number);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // presse-papiers indisponible : le numéro reste affiché en grand
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!isValidReference(reference)) return setError("Recopie l'identifiant de la transaction tel qu'il apparaît dans le SMS de confirmation.");
    if (!isValidPhone(payerPhone)) return setError("Numéro qui a payé : 10 chiffres.");
    const n = Number(amount.replace(/\s/g, ""));
    if (!Number.isFinite(n) || n < plan.price_fcfa) return setError(`Le montant de l'offre est de ${fcfa(plan.price_fcfa)}.`);
    setBusy(true);
    setError(null);
    try {
      const r = await callFunction<{ delayMinutes: number }>("paiement", {
        action: "declarer", plan: plan.code, method, reference, amount: n, payerPhone: normalizePhone(payerPhone),
      });
      onDone(`Merci ! Paiement déclaré. Ton offre ${plan.name} sera activée en moins de ${r.delayMinutes} minutes, après vérification. Tu recevras une notification.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Offre {plan.name}</h2>
          <p className="text-sm text-stone-500">30 jours, {fcfa(plan.price_fcfa)}</p>
        </div>
        <button type="button" className="text-sm font-medium text-brand-700" onClick={onCancel}>← Autre offre</button>
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold text-stone-800">1. Choisis ton moyen de paiement</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Moyen de paiement">
          {methods.map((m) => (
            <button key={m} type="button" role="radio" aria-checked={method === m} onClick={() => setMethod(m)}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-semibold transition ${method === m ? "border-brand-500 bg-brand-50 ring-2 ring-brand-200" : "border-stone-200 bg-white hover:border-stone-300"}`}>
              <span className={`h-3 w-3 shrink-0 rounded-full ${METHOD_STYLE[m]}`} aria-hidden />
              {PAYMENT_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl bg-stone-50 p-4 ring-1 ring-stone-200">
        <p className="text-sm font-semibold text-stone-800">2. Envoie {fcfa(plan.price_fcfa)} par {PAYMENT_LABELS[method]} au</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <p className="tabular text-3xl font-extrabold tracking-wide text-stone-900">{formatPhone(number)}</p>
          <Button type="button" variant="secondary" className="w-auto" onClick={() => void copy()}>{copied ? "Copié ✓" : "Copier"}</Button>
        </div>
        <p className="mt-1 text-sm text-stone-500">Au nom de {settings.manualPayment.holder}. Garde le SMS de confirmation : il contient l'identifiant de la transaction.</p>
      </div>

      <form onSubmit={submit} className="space-y-4" noValidate>
        <p className="text-sm font-semibold text-stone-800">3. Déclare ton paiement</p>
        <Field label="Identifiant de la transaction" hint="Dans le SMS de confirmation reçu après le paiement : « ID », « Réf. » ou « Transaction ».">
          {(id) => <Input id={id} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="Recopie l'identifiant" value={reference} onChange={(e) => setReference(e.target.value)} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Montant envoyé (FCFA)">
            {(id) => <Input id={id} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d\s]/g, ""))} />}
          </Field>
          <Field label="Numéro qui a payé">
            {(id) => <Input id={id} inputMode="tel" autoComplete="tel" placeholder="07 00 00 00 00" value={payerPhone} onChange={(e) => setPayerPhone(e.target.value)} />}
          </Field>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" loading={busy} className="w-full">J'ai payé, activer mon offre</Button>
        <p className="text-center text-sm text-stone-500">Activation en moins de {settings.manualPayment.delayMinutes} minutes après vérification.</p>
      </form>
    </Card>
  );
}
