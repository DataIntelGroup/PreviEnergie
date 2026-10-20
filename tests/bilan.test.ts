import { describe, expect, it } from "vitest";
import { planAlerts } from "../supabase/functions/_shared/alertes.ts";
import { consumptionInWindow, formatChange, weeklySummary } from "../supabase/functions/_shared/bilan.ts";
import { buildSegments, computeForecast, type Reading } from "../supabase/functions/_shared/prevision.ts";
import { DEFAULT_SETTINGS } from "../supabase/functions/_shared/reglages.ts";

const H = 3_600_000;
const NOW = new Date("2026-10-19T08:00:00Z"); // un lundi
const ago = (days: number) => new Date(NOW.getTime() - days * 24 * H).toISOString();

/** Relevés quotidiens sur `days` jours, `perDay(i)` kWh consommés le jour i (0 = le plus ancien). */
function readings(days: number, perDay: (i: number) => number): Reading[] {
  const out: Reading[] = [];
  let v = 500;
  for (let i = 0; i <= days; i++) {
    out.push({ id: `r${i}`, takenAt: ago(days - i), value: v });
    v -= perDay(i);
  }
  return out;
}

describe("bilan de la semaine", () => {
  it("compare aux 7 jours précédents", () => {
    // 7 jours à 4 kWh, puis 7 jours à 5 kWh.
    const segs = buildSegments("prepaid", readings(14, (i) => (i < 7 ? 4 : 5)), []);
    const w = weeklySummary(segs, [{ id: "c", purchasedAt: ago(2), kwh: 20, amountFcfa: 2200 }], NOW)!;
    expect(w.kwh).toBeCloseTo(35, 6);
    expect(w.previousKwh).toBeCloseTo(28, 6);
    expect(w.change).toBeCloseTo(0.25, 6);
    expect(w.spendFcfa).toBe(2200);
  });

  it("pas de bilan sans au moins 3 jours de relevés", () => {
    const segs = buildSegments("prepaid", readings(2, () => 5), []);
    expect(weeklySummary(segs, [], NOW)).toBeNull();
  });

  it("première semaine : pas de comparaison", () => {
    const segs = buildSegments("prepaid", readings(5, () => 5), []);
    const w = weeklySummary(segs, [], NOW)!;
    expect(w.previousKwh).toBeNull();
    expect(formatChange(w.change)).toBe("première semaine suivie");
  });

  it("formulation de l'évolution", () => {
    expect(formatChange(0.25)).toBe("+25 % par rapport à la semaine dernière");
    expect(formatChange(-0.1)).toBe("−10 % par rapport à la semaine dernière");
    expect(formatChange(0.01)).toBe("stable par rapport à la semaine dernière");
  });

  it("consommation sur une fenêtre partiellement couverte", () => {
    const segs = buildSegments("prepaid", readings(3, () => 6), []);
    const c = consumptionInWindow(segs, NOW.getTime() - 7 * 24 * H, NOW.getTime());
    expect(c.coveredDays).toBeCloseTo(3, 6);
    expect(c.kwh).toBeCloseTo(18, 6);
  });
});

describe("envoi du bilan", () => {
  const rs = readings(14, () => 5);
  const forecast = computeForecast("prepaid", rs, [], { now: NOW, safetyMargin: 0.2, defaultPriceKwh: 110, anomalyRatio: 2 });
  const weekly = weeklySummary(forecast.segments, [], NOW);
  const base = {
    meter: { id: "m", name: "Maison", kind: "prepaid" as const, createdAt: ago(30) },
    firstName: "Awa",
    forecast,
    settings: DEFAULT_SETTINGS,
    quiet: { start: "21:30", end: "07:00" },
    userChannels: ["push" as const, "email" as const],
    planChannels: ["push" as const, "email" as const],
    sent: [],
    weekly,
  };
  const bilans = (c: Parameters<typeof planAlerts>[0]) => planAlerts(c).filter((a) => a.type === "bilan");

  it("part le lundi à 8 h avec les chiffres de la semaine", () => {
    const [a] = bilans({ ...base, now: NOW });
    expect(a.cycleKey).toBe("semaine:2026-S43");
    expect(a.message).toContain("35 kWh");
    expect(a.message).toContain("stable");
    expect(a.channels).toEqual(["push", "email"]);
  });

  it("pas avant l'heure ni un autre jour", () => {
    expect(bilans({ ...base, now: new Date("2026-10-19T07:30:00Z") })).toEqual([]);
    expect(bilans({ ...base, now: new Date("2026-10-20T08:00:00Z") })).toEqual([]);
  });

  it("une seule fois par semaine", () => {
    expect(bilans({ ...base, now: NOW, sent: [{ type: "bilan", cycleKey: "semaine:2026-S43" }] })).toEqual([]);
  });

  it("l'abonné peut le désactiver", () => {
    expect(bilans({ ...base, now: NOW, weeklyEnabled: false })).toEqual([]);
  });

  it("jamais par SMS", () => {
    const [a] = bilans({ ...base, now: NOW, userChannels: ["sms", "push"], planChannels: ["sms", "push"] });
    expect(a.channels).toEqual(["push"]);
  });
});
