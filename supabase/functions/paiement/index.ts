// Paiement d'une offre (BF-22) depuis l'application.
//   { action: "declarer", plan, method, reference, amount, payerPhone }
//        paiement manuel : le client a envoyé l'argent sur un de nos numéros
//        et déclare la transaction ; l'équipe la vérifie et l'active.
//   { action: "init", plan }             -> { url } vers la page CinetPay (en réserve)
//   { action: "verifier", transactionId } -> statut revérifié chez CinetPay
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import { verifyAndApply, initPayment } from "../_shared/cinetpay.ts";
import { loadSettings } from "../_shared/donnees.ts";
import { notifyAdmins } from "../_shared/equipe.ts";
import { adminClient, env, handler, HttpError, json, readJson, requireEnv, requireUser } from "../_shared/serveur.ts";
import { isCinetPayAmount, isManualMethod, isValidPhone, isValidReference, normalizePhone, normalizeReference, PAYMENT_LABELS } from "../_shared/validation.ts";

interface Body {
  action?: "init" | "verifier" | "declarer";
  plan?: string;
  transactionId?: string;
  method?: string;
  reference?: string;
  amount?: number;
  payerPhone?: string;
}

const MAX_PENDING = 3;

async function declare(db: SupabaseClient, userId: string, b: Body) {
  if (!b.plan) throw new HttpError(400, "Choisis une offre");
  if (!isManualMethod(b.method)) throw new HttpError(400, "Choisis le moyen de paiement utilisé");
  if (!isValidReference(b.reference ?? "")) throw new HttpError(400, "Recopie l'identifiant de la transaction tel qu'il apparaît dans le SMS de confirmation");
  if (!isValidPhone(b.payerPhone ?? "")) throw new HttpError(400, "Numéro qui a payé invalide : 10 chiffres");
  const amount = Math.round(Number(b.amount));
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, "Indique le montant envoyé");

  const [{ data: plan }, { data: profile }, settings] = await Promise.all([
    db.from("plans").select("code, name, price_fcfa, active").eq("code", b.plan).maybeSingle(),
    db.from("profiles").select("first_name, last_name, phone, suspended").eq("id", userId).maybeSingle(),
    loadSettings(db),
  ]);
  if (!plan || !plan.active || plan.price_fcfa <= 0) throw new HttpError(400, "Offre indisponible");
  if (!profile?.first_name || !profile.last_name) throw new HttpError(400, "Complète ton profil d'abord");
  if (profile.suspended) throw new HttpError(403, "Compte suspendu");
  if (!settings.manualPayment.numbers[b.method]) throw new HttpError(400, "Ce moyen de paiement n'est pas disponible");
  if (amount < plan.price_fcfa) throw new HttpError(400, `Le montant de l'offre ${plan.name} est de ${plan.price_fcfa} FCFA : envoie le complément, puis déclare-le.`);

  const { count } = await db.from("payments").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "pending");
  if ((count ?? 0) >= MAX_PENDING) throw new HttpError(429, "Tu as déjà des paiements en vérification : attends leur validation.");

  const reference = normalizeReference(b.reference!);
  const transactionId = `PM${Date.now().toString(36).toUpperCase()}${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
  const ins = await db.from("payments").insert({
    user_id: userId,
    plan_code: plan.code,
    amount_fcfa: plan.price_fcfa,
    transaction_id: transactionId,
    method: b.method,
    reference,
    payer_phone: normalizePhone(b.payerPhone!),
    declared_amount: amount,
    raw: { mode: "manuel" },
  });
  if (ins.error) {
    if (ins.error.code === "23505") throw new HttpError(409, "Cette transaction a déjà été déclarée.");
    throw ins.error;
  }

  const who = `${profile.first_name} ${profile.last_name}`.trim();
  await notifyAdmins(db, "Paiement à vérifier",
    `${who} : ${amount} FCFA par ${PAYMENT_LABELS[b.method]} (réf. ${reference}) pour ${plan.name}.`,
    "/admin/a-traiter", `paiement-${transactionId}`);
  return { ok: true, transactionId, delayMinutes: settings.manualPayment.delayMinutes };
}

Deno.serve(handler(async (req) => {
  const user = await requireUser(req);
  const body = await readJson<Body>(req);
  const db = adminClient();

  if (body.action === "verifier") {
    if (!body.transactionId) throw new HttpError(400, "Transaction manquante");
    const { data: own } = await db.from("payments").select("user_id").eq("transaction_id", body.transactionId).maybeSingle();
    if (!own || own.user_id !== user.id) throw new HttpError(404, "Paiement introuvable");
    const result = await verifyAndApply(db, body.transactionId);
    return json(req, { status: result.status, until: "until" in result ? result.until : null });
  }

  if (body.action === "declarer") return json(req, await declare(db, user.id, body));

  if (body.action !== "init" || !body.plan) throw new HttpError(400, "Requête invalide");

  const [{ data: plan }, { data: profile }] = await Promise.all([
    db.from("plans").select("code, name, price_fcfa, active").eq("code", body.plan).maybeSingle(),
    db.from("profiles").select("first_name, last_name, phone, email, suspended").eq("id", user.id).maybeSingle(),
  ]);
  if (!plan || !plan.active || plan.price_fcfa <= 0) throw new HttpError(400, "Offre indisponible");
  if (!profile?.phone || !profile.first_name || !profile.last_name) throw new HttpError(400, "Complète ton profil d'abord");
  if (profile.suspended) throw new HttpError(403, "Compte suspendu");
  if (!isCinetPayAmount(plan.price_fcfa)) throw new HttpError(500, "Prix invalide pour CinetPay");

  // Identifiant unique, lisible dans le back-office CinetPay.
  const transactionId = `PE${Date.now().toString(36).toUpperCase()}${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
  const ins = await db.from("payments").insert({
    user_id: user.id,
    plan_code: plan.code,
    amount_fcfa: plan.price_fcfa,
    transaction_id: transactionId,
  });
  if (ins.error) throw ins.error;

  const appUrl = env("APP_URL") ?? "http://localhost:5173";
  const fnUrl = `${requireEnv("SUPABASE_URL")}/functions/v1`;
  try {
    const url = await initPayment({
      transactionId,
      amount: plan.price_fcfa,
      description: `PreviEnergie ${plan.name} 30 jours`,
      customer: { firstName: profile.first_name, lastName: profile.last_name, phone: profile.phone, email: profile.email },
      notifyUrl: `${fnUrl}/paiement-notif`,
      returnUrl: `${appUrl}/app/offres?transaction=${transactionId}`,
    });
    return json(req, { url, transactionId });
  } catch (e) {
    await db.from("payments").update({ status: "refused", raw: { error: String(e) }, verified_at: new Date().toISOString() })
      .eq("transaction_id", transactionId);
    console.error(e);
    throw new HttpError(502, "Le service de paiement ne répond pas. Réessaie dans quelques minutes.");
  }
}));
