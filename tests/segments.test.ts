import { describe, expect, it } from "vitest";
import { inSegment, personalize, type Segment, type SegmentProfile } from "../supabase/functions/_shared/segments";

const NOW = new Date("2026-10-22T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();
const base: SegmentProfile = { role: "user", suspended: false, plan_code: "gratuit", plan_expires_at: null, trial_ends_at: day(10), last_reading_at: day(-1) };
const groups = (p: Partial<SegmentProfile>) =>
  (["tous", "abonnes", "essai", "essai_fin", "expire", "renouvellement", "inactifs"] as Segment[]).filter((s) => inSegment({ ...base, ...p }, s, NOW));

describe("groupes de relance", () => {
  it("essai en cours, relevé hier", () => {
    expect(groups({})).toEqual(["tous", "essai"]);
  });

  it("essai qui finit dans 2 jours", () => {
    expect(groups({ trial_ends_at: day(2) })).toEqual(["tous", "essai", "essai_fin"]);
  });

  it("abonné dont l'offre finit dans 5 jours, sans relevé depuis 4 jours", () => {
    expect(groups({ plan_code: "essentiel", plan_expires_at: day(5), trial_ends_at: day(-20), last_reading_at: day(-4) })).toEqual([
      "tous", "abonnes", "renouvellement", "inactifs",
    ]);
  });

  it("lecture seule : ni « inactifs » ni « essai »", () => {
    expect(groups({ trial_ends_at: day(-1), last_reading_at: day(-10) })).toEqual(["tous", "expire"]);
    expect(groups({ plan_code: "essentiel", plan_expires_at: day(-2), trial_ends_at: day(-40) })).toEqual(["tous", "expire"]);
  });

  it("jamais relevé : inactif", () => {
    expect(groups({ last_reading_at: null })).toContain("inactifs");
  });

  it("équipe et comptes suspendus : aucun groupe", () => {
    expect(groups({ role: "admin" })).toEqual([]);
    expect(groups({ suspended: true })).toEqual([]);
  });
});

describe("personnalisation", () => {
  it("prénom inséré, et rien de bancal sans prénom", () => {
    expect(personalize("Bonjour {prenom}, ton essai finit.", "Aya")).toBe("Bonjour Aya, ton essai finit.");
    expect(personalize("Bonjour {prenom}, ton essai finit.", null)).toBe("Bonjour, ton essai finit.");
  });
});
