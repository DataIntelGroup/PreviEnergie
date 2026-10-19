import { describe, expect, it } from "vitest";
import { type AlertContext, channelsFor, levelFor, planAlerts } from "../supabase/functions/_shared/alertes.ts";
import type { Forecast } from "../supabase/functions/_shared/prevision.ts";
import { DEFAULT_SETTINGS, resolveSettings } from "../supabase/functions/_shared/reglages.ts";
import { inQuietHours, localParts } from "../supabase/functions/_shared/temps.ts";

const DAY = 86_400_000;

function forecast(now: Date, days: number | null, over: Partial<Forecast> = {}): Forecast {
  return {
    status: "standard",
    learning: { readings: 10, spanDays: 9, readingsNeeded: 0, daysNeeded: 0 },
    avgKwhDay: 5,
    priceKwh: 110,
    costPerDay: 550,
    balanceKwh: days === null ? null : days * 6,
    daysRemaining: days,
    cutoffAt: days === null ? null : new Date(now.getTime() + days * DAY).toISOString(),
    monthlyEstimateFcfa: null,
    lastReading: { id: "r", takenAt: new Date(now.getTime() - 3_600_000).toISOString(), value: 20 },
    cycleKey: "recharge-1",
    anomaly: false,
    segments: [],
    ...over,
  };
}

function ctx(nowIso: string, days: number | null, over: Partial<AlertContext> = {}, fOver: Partial<Forecast> = {}): AlertContext {
  const now = new Date(nowIso);
  return {
    now,
    meter: { id: "m1", name: "Maison", kind: "prepaid", createdAt: "2026-09-01T00:00:00Z" },
    firstName: "Awa",
    forecast: forecast(now, days, fOver),
    settings: DEFAULT_SETTINGS,
    quiet: { start: "21:30", end: "07:00" },
    userChannels: ["push", "email", "whatsapp", "sms"],
    planChannels: ["push", "email"],
    sent: [],
    ...over,
  };
}

const types = (c: AlertContext) => planAlerts(c).map((a) => a.type);

describe("heure d'Abidjan", () => {
  it("UTC+0 toute l'année", () => {
    const p = localParts(new Date("2026-10-19T18:05:00Z"));
    expect(p).toMatchObject({ hour: 18, minute: 5, date: "2026-10-19" });
  });

  it("heures calmes qui passent minuit", () => {
    expect(inQuietHours(22 * 60, "21:30", "07:00")).toBe(true);
    expect(inQuietHours(3 * 60, "21:30", "07:00")).toBe(true);
    expect(inQuietHours(7 * 60, "21:30", "07:00")).toBe(false);
    expect(inQuietHours(18 * 60, "21:30", "07:00")).toBe(false);
  });

  it("heures calmes dans la journée", () => {
    expect(inQuietHours(13 * 60, "12:00", "14:00")).toBe(true);
    expect(inQuietHours(15 * 60, "12:00", "14:00")).toBe(false);
  });
});

describe("alertes de niveau à 18 h", () => {
  it("J-5 à 18 h", () => {
    expect(types(ctx("2026-10-19T18:00:00Z", 4.5))).toEqual(["niveau_j5"]);
  });

  it("rien avant 18 h", () => {
    expect(types(ctx("2026-10-19T17:00:00Z", 4.5))).toEqual([]);
  });

  it("rien au-dessus de 5 jours", () => {
    expect(types(ctx("2026-10-19T18:00:00Z", 6))).toEqual([]);
  });

  it("J-2 à 18 h", () => {
    expect(types(ctx("2026-10-19T18:00:00Z", 1.8))).toEqual(["niveau_j2"]);
  });

  it("veille quand la coupure tombe avant demain 18 h", () => {
    expect(types(ctx("2026-10-19T18:00:00Z", 0.4))).toEqual(["veille"]);
  });

  it("une seule fois par cycle de recharge", () => {
    const sent = [{ type: "niveau_j5" as const, cycleKey: "recharge-1" }];
    expect(types(ctx("2026-10-20T18:00:00Z", 4, { sent }))).toEqual([]);
  });

  it("repart après une nouvelle recharge", () => {
    const sent = [{ type: "niveau_j5" as const, cycleKey: "recharge-0" }];
    expect(types(ctx("2026-10-20T18:00:00Z", 4, { sent }))).toEqual(["niveau_j5"]);
  });

  it("passe au niveau supérieur sans renvoyer l'inférieur", () => {
    const sent = [{ type: "niveau_j5" as const, cycleKey: "recharge-1" }];
    expect(types(ctx("2026-10-21T18:00:00Z", 1.5, { sent }))).toEqual(["niveau_j2"]);
  });

  it("ne redescend pas après une alerte plus grave", () => {
    const sent = [{ type: "veille" as const, cycleKey: "recharge-1" }];
    expect(types(ctx("2026-10-21T18:00:00Z", 1.5, { sent }))).toEqual([]);
  });

  it("aucune alerte de niveau pendant l'apprentissage", () => {
    const c = ctx("2026-10-19T18:00:00Z", 1, {}, { status: "insufficient" });
    expect(types(c)).toEqual([]);
  });

  it("aucune alerte de niveau en postpayé", () => {
    const c = ctx("2026-10-19T18:00:00Z", 1);
    c.meter.kind = "postpaid";
    expect(types(c)).toEqual([]);
  });

  it("aucun envoi pendant les heures calmes", () => {
    expect(types(ctx("2026-10-19T22:00:00Z", 0.2))).toEqual([]);
  });

  it("le message reprend le prénom, le compteur et les jours", () => {
    const [a] = planAlerts(ctx("2026-10-19T18:00:00Z", 1.8));
    expect(a.message).toContain("Awa");
    expect(a.message).toContain("Maison");
    expect(a.message).toContain("2 jours");
  });
});

describe("rappel de 21 h", () => {
  it("après une veille, si la coupure n'est pas passée", () => {
    const sent = [{ type: "veille" as const, cycleKey: "recharge-1" }];
    expect(types(ctx("2026-10-19T21:00:00Z", 0.2, { sent }))).toEqual(["veille_rappel"]);
  });

  it("pas de rappel sans veille (l'alerte J-5 manquée à 18 h part en rattrapage)", () => {
    expect(types(ctx("2026-10-19T21:00:00Z", 3))).toEqual(["niveau_j5"]);
  });

  it("pas de rappel si les heures calmes commencent avant 21 h", () => {
    const sent = [{ type: "veille" as const, cycleKey: "recharge-1" }];
    expect(types(ctx("2026-10-19T21:00:00Z", 0.2, { sent, quiet: { start: "20:30", end: "07:00" } }))).toEqual([]);
  });
});

describe("relance de relevé à 19 h", () => {
  const old = (h: number, now: string) => ({
    lastReading: { id: "r", takenAt: new Date(new Date(now).getTime() - h * 3_600_000).toISOString(), value: 20 },
  });

  it("après 48 h sans relevé en régime standard", () => {
    const now = "2026-10-19T19:00:00Z";
    expect(types(ctx(now, 8, {}, old(49, now)))).toEqual(["releve"]);
    expect(types(ctx(now, 8, {}, old(30, now)))).toEqual([]);
  });

  it("après 24 h pendant l'apprentissage", () => {
    const now = "2026-10-19T19:00:00Z";
    expect(types(ctx(now, null, {}, { ...old(25, now), status: "preliminary" }))).toEqual(["releve"]);
  });

  it("une fois par jour", () => {
    const now = "2026-10-19T20:00:00Z";
    const sent = [{ type: "releve" as const, cycleKey: "jour:2026-10-19" }];
    expect(types(ctx(now, 8, { sent }, old(50, now)))).toEqual([]);
  });

  it("pas avant 19 h", () => {
    const now = "2026-10-19T18:30:00Z";
    expect(types(ctx(now, 8, {}, old(50, now)))).toEqual([]);
  });
});

describe("consommation anormale", () => {
  it("une fois par cycle", () => {
    expect(types(ctx("2026-10-19T10:00:00Z", 8, {}, { anomaly: true }))).toEqual(["anomalie"]);
    const sent = [{ type: "anomalie" as const, cycleKey: "recharge-1" }];
    expect(types(ctx("2026-10-19T10:00:00Z", 8, { sent }, { anomaly: true }))).toEqual([]);
  });
});

describe("canaux selon l'offre et les préférences", () => {
  it("offre gratuite : notification et email seulement", () => {
    const [a] = planAlerts(ctx("2026-10-19T18:00:00Z", 0.4));
    expect(a.channels).toEqual(["push", "email"]);
  });

  it("offre payante : WhatsApp et SMS pour la veille", () => {
    const c = ctx("2026-10-19T18:00:00Z", 0.4, { planChannels: ["push", "email", "whatsapp", "sms"] });
    expect(planAlerts(c)[0].channels).toEqual(["push", "email", "whatsapp", "sms"]);
  });

  it("le SMS reste réservé aux alertes urgentes", () => {
    const c = { settings: DEFAULT_SETTINGS, userChannels: ["sms" as const], planChannels: ["sms" as const] };
    expect(channelsFor("niveau_j5", c)).toEqual([]);
    expect(channelsFor("veille", c)).toEqual(["sms"]);
  });

  it("respecte un canal coupé par l'utilisateur", () => {
    const c = ctx("2026-10-19T18:00:00Z", 0.4, { userChannels: ["push"] });
    expect(planAlerts(c)[0].channels).toEqual(["push"]);
  });

  it("aucun canal : aucune alerte", () => {
    expect(planAlerts(ctx("2026-10-19T18:00:00Z", 0.4, { userChannels: [] }))).toEqual([]);
  });
});

describe("réglages", () => {
  it("fusionne les valeurs en base avec les défauts", () => {
    const s = resolveSettings([
      { key: "thresholds", value: { j5: 4 } },
      { key: "inconnue", value: 1 },
    ]);
    expect(s.thresholds).toEqual({ j5: 4, j2: 2 });
    expect(s.safetyMargin).toBe(0.2);
  });

  it("un seuil modifié change le niveau", () => {
    const now = new Date("2026-10-19T18:00:00Z");
    const s = resolveSettings([{ key: "thresholds", value: { j5: 7 } }]);
    expect(levelFor(forecast(now, 6.5), s, now)).toBe("niveau_j5");
    expect(levelFor(forecast(now, 6.5), DEFAULT_SETTINGS, now)).toBeNull();
  });
});
