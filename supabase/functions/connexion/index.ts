// Connexion avec un numéro de téléphone et un mot de passe. Supabase ne
// connaît que l'email : le serveur retrouve l'email du numéro, sans jamais le
// révéler, ouvre la session et renvoie ses jetons. 5 échecs en 15 minutes
// bloquent le numéro ; le message d'erreur ne dit pas si le numéro existe.
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { isValidPhone, normalizePhone } from "../_shared/validation.ts";
import { adminClient, handler, HttpError, json, readJson, requireEnv } from "../_shared/serveur.ts";

const WRONG = "Numéro ou mot de passe incorrect.";
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60_000;

Deno.serve(handler(async (req) => {
  const { phone, password } = await readJson<{ phone?: string; password?: string }>(req);
  const p = normalizePhone(phone ?? "");
  if (!isValidPhone(p) || !password) throw new HttpError(400, WRONG);

  const db = adminClient();
  const { count } = await db.from("login_attempts").select("id", { count: "exact", head: true })
    .eq("phone", p).eq("success", false).gte("created_at", new Date(Date.now() - WINDOW_MS).toISOString());
  if ((count ?? 0) >= MAX_FAILURES) throw new HttpError(429, "Trop d'essais : réessaie dans 15 minutes, ou connecte-toi avec ton email.");

  const { data: profile } = await db.from("profiles").select("email").eq("phone", p).maybeSingle();
  let session: { access_token: string; refresh_token: string } | null = null;
  if (profile?.email) {
    const auth = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_ANON_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await auth.auth.signInWithPassword({ email: profile.email, password });
    if (!error && data.session) session = data.session;
  }

  await db.from("login_attempts").insert({ phone: p, success: !!session });
  // Ménage : on ne garde qu'une journée de tentatives.
  await db.from("login_attempts").delete().lt("created_at", new Date(Date.now() - 86_400_000).toISOString());
  if (!session) throw new HttpError(401, WRONG);
  return json(req, { access_token: session.access_token, refresh_token: session.refresh_token });
}));
