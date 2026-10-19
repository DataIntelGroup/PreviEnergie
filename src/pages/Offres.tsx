// Offres mensuelles sans engagement, payées par mobile money via CinetPay
// (BF-22). Au retour de CinetPay, le statut est revérifié côté serveur.
import { CHANNEL_LABELS } from "@shared/reglages.ts";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button, Card, Notice, PageTitle, Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useData } from "@/lib/data";
import { fcfa, fmtDate, fmtDateLong } from "@/lib/format";
import { callFunction, errorMessage, supabase } from "@/lib/supabase";
import { effectivePlanCode, type PaymentRow } from "@/lib/types";

const STATUS = { pending: "En attente", accepted: "Payé", refused: "Refusé" } as const;

export default function Offres() {
  const { profile, refreshProfile } = useAuth();
  const { plans, refreshMeters } = useData();
  const [params, setParams] = useSearchParams();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState<"pending" | "accepted" | "refused" | null>(null);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const polled = useRef(false);

  const loadPayments = () =>
    supabase.from("payments").select("*").order("created_at", { ascending: false }).limit(10)
      .then(({ data }) => setPayments((data as PaymentRow[]) ?? []));

  useEffect(() => {
    void loadPayments();
  }, []);

  // Retour de la page de paiement : revérification jusqu'à 40 secondes.
  useEffect(() => {
    const tx = params.get("transaction");
    if (!tx || polled.current) return;
    polled.current = true;
    setChecking("pending");
    let stop = false;
    (async () => {
      for (let i = 0; i < 8 && !stop; i++) {
        try {
          const r = await callFunction<{ status: string }>("paiement", { action: "verifier", transactionId: tx });
          if (r.status === "accepted" || r.status === "refused") {
            setChecking(r.status);
            await Promise.all([refreshProfile(), refreshMeters(), loadPayments()]);
            setParams({}, { replace: true });
            return;
          }
        } catch (e) {
          console.warn(e);
        }
        await new Promise((res) => setTimeout(res, 5000));
      }
      setChecking(null);
      setError("Paiement toujours en attente. Il sera pris en compte automatiquement dès sa confirmation.");
      void loadPayments();
    })();
    return () => {
      stop = true;
    };
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!profile) return null;
  const current = effectivePlanCode(profile);

  async function pay(code: string) {
    setBusy(code);
    setError(null);
    try {
      const { url } = await callFunction<{ url: string }>("paiement", { action: "init", plan: code });
      window.location.assign(url);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <PageTitle>Offres</PageTitle>
      <p className="text-stone-600">Sans engagement, 30 jours par paiement. Wave, Orange Money, MTN MoMo ou Moov Money.</p>

      {checking === "pending" && (
        <Notice className="flex items-center gap-2"><Spinner className="h-4 w-4" /> Vérification du paiement auprès de CinetPay…</Notice>
      )}
      {checking === "accepted" && <Notice tone="success">Paiement confirmé. Ton offre est active, merci !</Notice>}
      {checking === "refused" && <Notice tone="error">Paiement refusé ou annulé. Ton offre n'a pas changé.</Notice>}
      {error && <Notice tone="warning">{error}</Notice>}

      {current !== "gratuit" && profile.plan_expires_at && (
        <Card className="bg-brand-50 ring-brand-200">
          <p className="text-sm text-brand-800">
            Offre <strong>{plans.find((p) => p.code === current)?.name}</strong> active jusqu'au {fmtDateLong(profile.plan_expires_at)}.
            Payer à nouveau prolonge de 30 jours à partir de cette date.
          </p>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {plans.filter((p) => p.active).map((p) => {
          const isCurrent = p.code === current;
          return (
            <Card key={p.code} className={isCurrent ? "ring-2 ring-brand-500" : ""}>
              <div className="flex items-baseline justify-between">
                <h2 className="text-lg font-bold">{p.name}</h2>
                <p className="tabular text-lg font-bold text-brand-700">
                  {p.price_fcfa === 0 ? "0 FCFA" : fcfa(p.price_fcfa)}
                  <span className="text-sm font-normal text-stone-500"> / mois</span>
                </p>
              </div>
              <ul className="mt-2 space-y-1 text-sm text-stone-700">
                <li>✓ {p.max_meters} compteur{p.max_meters > 1 ? "s" : ""}</li>
                <li>✓ Alertes : {p.channels.map((c) => CHANNEL_LABELS[c]).join(", ")}</li>
                <li>✓ Historique {p.history_days ? `de ${p.history_days} jours` : "illimité"}</li>
              </ul>
              {p.price_fcfa > 0 && (
                <Button className="mt-4 w-full" variant={isCurrent ? "secondary" : "primary"} loading={busy === p.code} disabled={!!busy} onClick={() => void pay(p.code)}>
                  {isCurrent ? "Prolonger de 30 jours" : `Choisir ${p.name}`}
                </Button>
              )}
              {isCurrent && p.price_fcfa === 0 && <p className="mt-3 text-sm font-medium text-stone-500">Ton offre actuelle</p>}
            </Card>
          );
        })}
      </div>

      {payments.length > 0 && (
        <div>
          <h2 className="mb-2 font-semibold">Mes paiements</h2>
          <ul className="divide-y divide-stone-200 overflow-hidden rounded-2xl bg-white ring-1 ring-stone-200">
            {payments.map((p) => (
              <li key={p.id} className="flex justify-between px-4 py-3 text-sm">
                <span>
                  {plans.find((x) => x.code === p.plan_code)?.name ?? p.plan_code} · {fmtDate(p.created_at)}
                </span>
                <span className={p.status === "accepted" ? "text-emerald-700" : p.status === "refused" ? "text-red-600" : "text-stone-500"}>
                  {fcfa(p.amount_fcfa)} · {STATUS[p.status]}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
