// Statut d'accès d'un abonné, même règle que public.access_status en base :
// offre payante en cours, essai gratuit en cours, ou essai terminé (lecture seule).
import { DAY_MS } from "./temps.ts";

export type AccessStatus = "paid" | "trial" | "expired";

export interface AccessProfile {
  plan_code: string;
  plan_expires_at: string | null;
  trial_ends_at: string;
}

export function accessStatus(p: AccessProfile, now: Date): AccessStatus {
  if (p.plan_code !== "gratuit" && (!p.plan_expires_at || new Date(p.plan_expires_at) > now)) return "paid";
  return new Date(p.trial_ends_at) > now ? "trial" : "expired";
}

/** Jours d'essai restants, arrondis au jour supérieur ; null hors essai. */
export function trialDaysLeft(p: AccessProfile, now: Date): number | null {
  if (accessStatus(p, now) !== "trial") return null;
  return Math.max(1, Math.ceil((new Date(p.trial_ends_at).getTime() - now.getTime()) / DAY_MS));
}
