// Toutes les adresses de l'application, en un seul endroit : un lien ne
// s'écrit jamais à la main ailleurs. Le serveur (alertes, paiement) utilise
// les mêmes chemins, voir supabase/functions/_shared/canaux.ts.

export const R = {
  accueilPublic: "/",
  connexion: "/connexion",
  profil: "/profil",
  confidentialite: "/confidentialite",
  app: "/app",
  releve: "/app/releve",
  recharge: "/app/recharge",
  historique: "/app/historique",
  alertes: "/app/alertes",
  compteurs: "/app/compteurs",
  offres: "/app/offres",
  compte: "/app/compte",
  admin: "/admin",
} as const;

/** Ajoute des paramètres à une adresse, en ignorant les valeurs vides. */
export function withQuery(path: string, params: Record<string, string | number | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

/** Retour après connexion : uniquement un chemin interne, jamais « //hote ». */
export function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return R.app;
  return value;
}
