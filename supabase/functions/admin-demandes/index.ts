// Demandes à traiter par l'équipe (administrateurs seulement).
//   { action: "liste" }                          paiements en attente, demandes de mot de passe ouvertes
//   { action: "valider", paymentId }             active l'offre (apply_payment), prévient le client
//   { action: "refuser", paymentId, reason }     refuse, prévient le client
//   { action: "code", resetId }                  nouveau code à 6 chiffres, renvoyé une seule fois
//   { action: "clore", resetId }                 demande classée sans suite
import { notifyUser } from "../_shared/equipe.ts";
import { codeHash, newResetCode } from "../_shared/reinitialisation.ts";
import { adminClient, handler, HttpError, json, readJson, requireUser } from "../_shared/serveur.ts";

interface Body {
  action?: "liste" | "valider" | "refuser" | "code" | "clore";
  paymentId?: string;
  resetId?: string;
  reason?: string;
}

const CODE_HOURS = 24;

Deno.serve(handler(async (req) => {
  const user = await requireUser(req);
  const db = adminClient();
  const { data: me } = await db.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") throw new HttpError(403, "Réservé aux administrateurs");
  const b = await readJson<Body>(req);

  if (b.action === "liste") {
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const [pending, recent, resets] = await Promise.all([
      db.from("payments").select("id, user_id, plan_code, amount_fcfa, declared_amount, method, reference, payer_phone, created_at")
        .eq("status", "pending").not("reference", "is", null).order("created_at"),
      db.from("payments").select("id, user_id, plan_code, amount_fcfa, declared_amount, method, reference, status, refusal_reason, verified_at")
        .not("reference", "is", null).neq("status", "pending").gte("verified_at", since).order("verified_at", { ascending: false }).limit(20),
      db.from("password_resets").select("id, user_id, status, code_expires_at, attempts, created_at, handled_at")
        .in("status", ["requested", "code_sent"]).gte("created_at", new Date(Date.now() - 3 * 86_400_000).toISOString()).order("created_at"),
    ]);
    for (const r of [pending, recent, resets]) if (r.error) throw r.error;
    const ids = [...new Set([...(pending.data ?? []), ...(recent.data ?? []), ...(resets.data ?? [])].map((x) => x.user_id).filter(Boolean))];
    const { data: people } = ids.length
      ? await db.from("profiles").select("id, first_name, last_name, phone, email").in("id", ids)
      : { data: [] };
    return json(req, { pending: pending.data, recent: recent.data, resets: resets.data, people });
  }

  if (b.action === "valider" || b.action === "refuser") {
    if (!b.paymentId) throw new HttpError(400, "Paiement manquant");
    const { data: pay } = await db.from("payments").select("id, user_id, transaction_id, method, status, plan_code, raw").eq("id", b.paymentId).maybeSingle();
    if (!pay) throw new HttpError(404, "Paiement introuvable");
    if (pay.status !== "pending") throw new HttpError(409, "Ce paiement a déjà été traité");
    const reason = (b.reason ?? "").trim().slice(0, 200);
    if (b.action === "refuser" && !reason) throw new HttpError(400, "Indique la raison du refus");

    const raw = { ...(pay.raw ?? {}), reviewed_by: user.id, ...(reason ? { reason } : {}) };
    const { data: result, error } = await db.rpc("apply_payment", {
      p_transaction_id: pay.transaction_id, p_status: b.action === "valider" ? "accepted" : "refused", p_method: pay.method, p_raw: raw,
    });
    if (error) throw error;
    await db.from("payments").update({ reviewed_by: user.id, refusal_reason: reason || null }).eq("id", pay.id);
    await db.from("audit_log").insert({
      actor_id: user.id, action: b.action === "valider" ? "payment.validate" : "payment.refuse", target_type: "profile", target_id: pay.user_id,
      details: { transaction_id: pay.transaction_id, plan: pay.plan_code, ...(reason ? { reason } : {}) },
    });

    const { data: plan } = await db.from("plans").select("name").eq("code", pay.plan_code).maybeSingle();
    if (pay.user_id) {
      if (b.action === "valider") {
        const until = (result as { until?: string } | null)?.until;
        const date = until ? new Date(until).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "Africa/Abidjan" }) : null;
        await notifyUser(db, pay.user_id, "Paiement confirmé", `Ton offre ${plan?.name ?? ""} est active${date ? ` jusqu'au ${date}` : ""}. Merci !`, "/app/offres", `paiement-${pay.id}`);
      } else {
        await notifyUser(db, pay.user_id, "Paiement non validé", `${reason}. Ouvre PréviÉnergie pour corriger ta déclaration.`, "/app/offres", `paiement-${pay.id}`);
      }
    }
    return json(req, { ok: true, result });
  }

  if (b.action === "code" || b.action === "clore") {
    if (!b.resetId) throw new HttpError(400, "Demande manquante");
    const { data: reset } = await db.from("password_resets").select("id, user_id, status").eq("id", b.resetId).maybeSingle();
    if (!reset || !["requested", "code_sent"].includes(reset.status)) throw new HttpError(404, "Demande introuvable ou déjà traitée");
    const now = new Date();
    if (b.action === "clore") {
      await db.from("password_resets").update({ status: "closed", code_hash: null, handled_by: user.id, handled_at: now.toISOString() }).eq("id", reset.id);
      return json(req, { ok: true });
    }
    const code = newResetCode();
    const expires = new Date(now.getTime() + CODE_HOURS * 3_600_000);
    await db.from("password_resets").update({
      status: "code_sent", code_hash: await codeHash(reset.id, code), code_expires_at: expires.toISOString(),
      attempts: 0, handled_by: user.id, handled_at: now.toISOString(),
    }).eq("id", reset.id);
    await db.from("audit_log").insert({ actor_id: user.id, action: "user.reset_code", target_type: "profile", target_id: reset.user_id, details: {} });
    return json(req, { code, expiresAt: expires.toISOString() });
  }

  throw new HttpError(400, "Requête invalide");
}));
