// Création de compte avec un numéro de téléphone et un mot de passe, sans
// SMS. Le compte Supabase reçoit une adresse interne (phoneEmail) que
// personne ne voit ; le profil garde le numéro (handle_new_user). Le serveur
// ouvre ensuite la session et renvoie ses jetons, comme la fonction connexion.
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { isValidPhone, normalizePhone, PASSWORD_MIN, phoneEmail } from "../_shared/validation.ts";
import { adminClient, handler, HttpError, json, readJson, requireEnv } from "../_shared/serveur.ts";

const TAKEN = "Ce numéro a déjà un compte : connecte-toi avec ton mot de passe.";
const MAX_PER_HOUR = 20;

Deno.serve(handler(async (req) => {
  const { phone, password, source } = await readJson<{ phone?: string; password?: string; source?: string }>(req);
  const p = normalizePhone(phone ?? "");
  if (!isValidPhone(p)) throw new HttpError(400, "Numéro invalide : 10 chiffres, par exemple 07 00 00 00 00.");
  if (!password || password.length < PASSWORD_MIN) throw new HttpError(400, `Le mot de passe doit faire au moins ${PASSWORD_MIN} caractères.`);

  const db = adminClient();
  // Frein simple contre la création de comptes en série.
  const { count } = await db.from("profiles").select("id", { count: "exact", head: true })
    .is("email", null).gte("created_at", new Date(Date.now() - 3_600_000).toISOString());
  if ((count ?? 0) >= MAX_PER_HOUR) throw new HttpError(429, "Beaucoup d'inscriptions en ce moment : réessaie dans un moment, ou crée ton compte avec ton email.");

  const { data: existing } = await db.from("profiles").select("id").eq("phone", p).maybeSingle();
  if (existing) throw new HttpError(409, TAKEN);

  const email = phoneEmail(p);
  const { error: createError } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { phone: p, source: (source ?? "").slice(0, 60) || undefined },
  });
  if (createError) {
    if (/already|registered|exists|duplicate|unique|database error/i.test(createError.message)) throw new HttpError(409, TAKEN);
    if (/password/i.test(createError.message)) throw new HttpError(400, "Mot de passe trop simple : choisis-en un plus long.");
    throw createError;
  }

  const auth = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_ANON_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await auth.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new HttpError(500, "Compte créé, mais la connexion a échoué : connecte-toi avec ton numéro.");
  return json(req, { access_token: data.session.access_token, refresh_token: data.session.refresh_token });
}));
