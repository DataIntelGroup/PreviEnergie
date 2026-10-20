import { describe, expect, it } from "vitest";
import { accessStatus, trialDaysLeft } from "../supabase/functions/_shared/acces.ts";

const now = new Date("2026-10-20T12:00:00Z");
const p = (plan: string, expires: string | null, trial: string) => ({ plan_code: plan, plan_expires_at: expires, trial_ends_at: trial });

describe("statut d'accès", () => {
  it("essai en cours", () => {
    expect(accessStatus(p("gratuit", null, "2026-10-25T12:00:00Z"), now)).toBe("trial");
    expect(trialDaysLeft(p("gratuit", null, "2026-10-25T12:00:00Z"), now)).toBe(5);
  });

  it("essai terminé sans offre : lecture seule", () => {
    expect(accessStatus(p("gratuit", null, "2026-10-19T12:00:00Z"), now)).toBe("expired");
    expect(trialDaysLeft(p("gratuit", null, "2026-10-19T12:00:00Z"), now)).toBeNull();
  });

  it("offre payée en cours, même après l'essai", () => {
    expect(accessStatus(p("decouverte", "2026-11-19T12:00:00Z", "2026-10-01T00:00:00Z"), now)).toBe("paid");
  });

  it("offre payée échue et essai fini : lecture seule", () => {
    expect(accessStatus(p("decouverte", "2026-10-20T11:00:00Z", "2026-10-01T00:00:00Z"), now)).toBe("expired");
  });

  it("dernier jour d'essai : il reste 1 jour", () => {
    expect(trialDaysLeft(p("gratuit", null, "2026-10-20T13:00:00Z"), now)).toBe(1);
  });
});
