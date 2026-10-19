// CinetPay (mobile money). Règle d'or (BF-22) : on n'active jamais une offre
// sur la foi d'une redirection ou d'une notification ; on revérifie le
// statut auprès de CinetPay, montant et devise compris.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import { requireEnv } from "./serveur.ts";

const API = "https://api-checkout.cinetpay.com/v2";

const METHODS: Record<string, string> = {
  OM: "orange_money",
  OMCIV2: "orange_money",
  MOMO: "mtn_momo",
  MOMOCI: "mtn_momo",
  FLOOZ: "moov_money",
  MOOV: "moov_money",
  WAVECI: "wave",
  WAVE: "wave",
  CARD: "carte",
  VISAM: "carte",
};

export interface InitParams {
  transactionId: string;
  amount: number;
  description: string;
  customer: { firstName: string; lastName: string; phone: string; email: string | null };
  notifyUrl: string;
  returnUrl: string;
}

export async function initPayment(p: InitParams): Promise<string> {
  const res = await fetch(`${API}/payment`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      apikey: requireEnv("CINETPAY_API_KEY"),
      site_id: requireEnv("CINETPAY_SITE_ID"),
      transaction_id: p.transactionId,
      amount: p.amount,
      currency: "XOF",
      description: p.description,
      notify_url: p.notifyUrl,
      return_url: p.returnUrl,
      channels: "MOBILE_MONEY",
      lang: "fr",
      customer_name: p.customer.firstName,
      customer_surname: p.customer.lastName,
      customer_phone_number: `+225${p.customer.phone}`,
      customer_email: p.customer.email ?? undefined,
    }),
  });
  const data = await res.json().catch(() => null) as { code?: string; message?: string; data?: { payment_url?: string } } | null;
  if (!res.ok || data?.code !== "201" || !data.data?.payment_url) {
    throw new Error(`CinetPay init : ${data?.code ?? res.status} ${data?.message ?? ""}`.trim());
  }
  return data.data.payment_url;
}

export interface CheckResult {
  status: "accepted" | "refused" | "pending";
  method: string | null;
  raw: unknown;
}

export async function checkPayment(transactionId: string, expectedAmount: number): Promise<CheckResult> {
  const res = await fetch(`${API}/payment/check`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      apikey: requireEnv("CINETPAY_API_KEY"),
      site_id: requireEnv("CINETPAY_SITE_ID"),
      transaction_id: transactionId,
    }),
  });
  const raw = await res.json().catch(() => null) as {
    code?: string;
    data?: { status?: string; amount?: string | number; currency?: string; payment_method?: string };
  } | null;
  const d = raw?.data;
  const method = d?.payment_method ? METHODS[d.payment_method.toUpperCase()] ?? d.payment_method.toLowerCase() : null;
  const status = d?.status?.toUpperCase();
  if (status === "ACCEPTED") {
    // Montant ou devise différents : on refuse, quelle que soit la cause.
    const ok = Number(d?.amount) === expectedAmount && (d?.currency ?? "XOF").toUpperCase() === "XOF";
    return { status: ok ? "accepted" : "refused", method, raw };
  }
  if (status === "REFUSED" || status === "CANCELED" || status === "CANCELLED") return { status: "refused", method, raw };
  return { status: "pending", method, raw };
}

/** Revérifie une transaction et applique le résultat. Idempotent. */
export async function verifyAndApply(db: SupabaseClient, transactionId: string) {
  const { data: payment, error } = await db
    .from("payments")
    .select("id, user_id, status, amount_fcfa, plan_code")
    .eq("transaction_id", transactionId)
    .maybeSingle();
  if (error) throw error;
  if (!payment) return { status: "unknown" as const, payment: null };
  if (payment.status !== "pending") return { status: payment.status as string, payment };

  const check = await checkPayment(transactionId, payment.amount_fcfa);
  if (check.status === "pending") return { status: "pending", payment };
  const applied = await db.rpc("apply_payment", {
    p_transaction_id: transactionId,
    p_status: check.status,
    p_method: check.method,
    p_raw: check.raw,
  });
  if (applied.error) throw applied.error;
  return { status: check.status, payment, until: (applied.data as { until?: string })?.until ?? null };
}
