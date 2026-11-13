// Mot de passe oublié, sans SMS ni email garanti. Appelée avant d'être connecté.
//   { action: "demander", login }                 email ou numéro : l'équipe est
//        prévenue et envoie un code par WhatsApp au numéro du compte.
//   { action: "reinitialiser", login, code, password } -> jetons de session
// La réponse ne dit jamais si le compte existe. Le code (6 chiffres) n'est
// gardé que sous forme d'empreinte : 5 essais, valable 24 heures.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { notifyAdmins } from "../_shared/equipe.ts";
import { codeHash } from "../_shared/reinitialisation.ts";
import { adminClient, handler, HttpError, json, readJson, requireEnv } from "../_shared/serveur.ts";
import { isValidPhone, normalizePhone, PASSWORD_MIN } from "../_shared/validation.ts";

const MAX_ATTEMPTS = 5;
const WRONG = "Code incorrect ou expiré. Vérifie le message reçu, ou refais une demande.";

interface Body {
  action?: "demander" | "reinitialiser";
  login?: string;
  code?: string;
  password?: string;
}

/** Compte désigné par un email ou un numéro, ou null. */
async function findUser(db: SupabaseClient, login: string) {
  const id = login.trim();
  if (!id) return null;
  if (id.includes("@")) {
    const { data } = await db.from("profiles").select("id, first_name, last_name, phone, email, suspended").eq("email", id.toLowerCase()).maybeSingle();
    return data;
  }
  if (!isValidPhone(id)) return null;
  const { data } = await db.from("profiles").select("id, first_name, last_name, phone, email, suspended").eq("phone", normalizePhone(id)).maybeSingle();
  return data;
}

Deno.serve(handler(async (req) => {
  const b = await readJson<Body>(req);
  const db = adminClient();

  if (b.action === "demander") {
    const login = (b.login ?? "").trim();
    if (!login.includes("@") && !isValidPhone(login)) throw new HttpError(400, "Entre ton email ou ton numéro de 10 chiffres.");
    // Frein global contre l'envoi en série.
    const { count } = await db.from("password_resets").select("id", { count: "exact", head: true })
      .gte("created_at", new Date(Date.now() - 3_600_000).toISOString());
    if ((count ?? 0) >= 30) throw new HttpError(429, "Beaucoup de demandes en ce moment : réessaie dans un moment.");

    const user = await findUser(db, login);
    if (user && !user.suspended) {
      // Une seule demande ouverte à la fois : on ne prévient l'équipe qu'une fois.
      const { data: open } = await db.from("password_resets").select("id").eq("user_id", user.id)
        .in("status", ["requested", "code_sent"]).gte("created_at", new Date(Date.now() - 86_400_000).toISOString()).limit(1);
      if (!open?.length) {
        await db.from("password_resets").insert({ user_id: user.id });
        const who = `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || user.email || user.phone || "Un client";
        await notifyAdmins(db, "Mot de passe oublié", `${who} demande un code pour changer son mot de passe.`, "/admin/a-traiter", `mdp-${user.id}`);
      }
    }
    return json(req, { ok: true });
  }

  if (b.action === "reinitialiser") {
    const code = (b.code ?? "").replace(/\D/g, "");
    if (code.length !== 6) throw new HttpError(400, "Le code contient 6 chiffres.");
    if (!b.password || b.password.length < PASSWORD_MIN) throw new HttpError(400, `Le mot de passe doit faire au moins ${PASSWORD_MIN} caractères.`);
    const user = await findUser(db, b.login ?? "");
    if (!user || user.suspended) throw new HttpError(400, WRONG);

    const { data: reset } = await db.from("password_resets").select("id, code_hash, code_expires_at, attempts")
      .eq("user_id", user.id).eq("status", "code_sent").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!reset || !reset.code_hash || !reset.code_expires_at || new Date(reset.code_expires_at) < new Date() || reset.attempts >= MAX_ATTEMPTS) {
      throw new HttpError(400, WRONG);
    }
    if (await codeHash(reset.id, code) !== reset.code_hash) {
      const attempts = reset.attempts + 1;
      await db.from("password_resets").update({ attempts, ...(attempts >= MAX_ATTEMPTS ? { status: "closed" } : {}) }).eq("id", reset.id);
      throw new HttpError(400, attempts >= MAX_ATTEMPTS ? "Trop d'essais : refais une demande de code." : WRONG);
    }

    const { data: account, error: getError } = await db.auth.admin.getUserById(user.id);
    if (getError || !account.user?.email) throw new HttpError(500, "Compte introuvable : écris-nous.");
    const { error: updError } = await db.auth.admin.updateUserById(user.id, { password: b.password });
    if (updError) throw new HttpError(400, /password/i.test(updError.message) ? "Mot de passe trop simple : choisis-en un plus long." : updError.message);
    await db.from("password_resets").update({ status: "used", code_hash: null }).eq("id", reset.id);
    await db.from("audit_log").insert({ actor_id: user.id, action: "user.password_reset", target_type: "profile", target_id: user.id, details: { by: "code" } });

    const auth = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_ANON_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await auth.auth.signInWithPassword({ email: account.user.email, password: b.password });
    if (error || !data.session) throw new HttpError(500, "Mot de passe changé : connecte-toi avec le nouveau.");
    return json(req, { access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  }

  throw new HttpError(400, "Requête invalide");
}));
