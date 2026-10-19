import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Faux tant que .env.local n'a pas l'URL et la clé publique du projet. */
export const isConfigured = Boolean(url && key);

// Seule la clé publique (anon / publishable) est embarquée : la RLS protège
// les données, la clé service_role ne quitte jamais le serveur.
export const supabase = createClient(url || "http://localhost", key || "absente", {
  // detectSessionInUrl : le lien de l'email connecte aussi (email par défaut sans SMTP).
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/** Message lisible pour une erreur Supabase, PostgREST ou d'une fonction. */
export function errorMessage(e: unknown): string {
  if (!e) return "Erreur inconnue";
  if (typeof e === "string") return e;
  const err = e as { message?: string; code?: string; context?: unknown };
  if (err.code === "42501") return "Action non autorisée.";
  if (err.message?.includes("Failed to fetch")) return "Pas de connexion internet. Réessaie.";
  return err.message ?? "Erreur inconnue";
}

/**
 * Appel d'une fonction Edge. Les erreurs renvoyées par la fonction
 * (`{ error }`) remontent avec leur message.
 */
export async function callFunction<T>(name: string, body: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body: body as Record<string, unknown> });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      const payload = await ctx.json().catch(() => null);
      if (payload?.error) throw new Error(payload.error);
    }
    throw new Error(errorMessage(error));
  }
  return data as T;
}
