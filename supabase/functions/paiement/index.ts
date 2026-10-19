// Paiement d'une offre (BF-22) depuis l'application.
//   { action: "init", plan }             -> { url } vers la page CinetPay
//   { action: "verifier", transactionId } -> statut revérifié chez CinetPay
import { verifyAndApply, initPayment } from "../_shared/cinetpay.ts";
import { adminClient, env, handler, HttpError, json, readJson, requireEnv, requireUser } from "../_shared/serveur.ts";
import { isCinetPayAmount } from "../_shared/validation.ts";

interface Body {
  action?: "init" | "verifier";
  plan?: string;
  transactionId?: string;
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
