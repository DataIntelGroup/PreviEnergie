import { describe, expect, it } from "vitest";
import {
  buildSegments,
  checkReading,
  computeForecast,
  consumptionBetween,
  currentCycleKey,
  dailyConsumption,
  detectAnomaly,
  gaugeLevel,
  learningState,
  type Reading,
  type Recharge,
  weightedAverage,
} from "../supabase/functions/_shared/prevision.ts";

const T0 = new Date("2026-10-01T08:00:00Z").getTime();
const H = 3_600_000;
const at = (hours: number) => new Date(T0 + hours * H).toISOString();
const r = (hours: number, value: number, id = `r${hours}`): Reading => ({ id, takenAt: at(hours), value });
const rc = (hours: number, kwh: number, amountFcfa: number, id = `c${hours}`): Recharge => ({
  id,
  purchasedAt: at(hours),
  kwh,
  amountFcfa,
});
const opts = (nowHours: number) => ({
  now: new Date(T0 + nowHours * H),
  safetyMargin: 0.2,
  defaultPriceKwh: 110,
  anomalyRatio: 2,
});

/** Relevés quotidiens à 8 h, `perDay` kWh consommés par jour, sans recharge. */
function daily(days: number, start: number, perDay: number): Reading[] {
  return Array.from({ length: days }, (_, i) => r(i * 24, start - i * perDay));
}

describe("consommation entre deux relevés", () => {
  it("prépayé : solde précédent moins solde actuel", () => {
    expect(consumptionBetween("prepaid", r(0, 50), r(24, 44), [])).toBe(6);
  });

  it("prépayé : déduit les recharges de l'intervalle", () => {
    expect(consumptionBetween("prepaid", r(0, 10), r(24, 40), [rc(12, 36, 4000)])).toBe(6);
  });

  it("ignore une recharge hors de l'intervalle", () => {
    expect(consumptionBetween("prepaid", r(0, 50), r(24, 44), [rc(30, 36, 4000)])).toBe(6);
  });

  it("postpayé : différence d'index", () => {
    expect(consumptionBetween("postpaid", r(0, 1200), r(24, 1207.5), [])).toBe(7.5);
  });
});

describe("segments et moyenne pondérée", () => {
  it("regroupe les relevés trop rapprochés", () => {
    const segs = buildSegments("prepaid", [r(0, 50), r(1, 49.8), r(24, 44)], []);
    expect(segs).toHaveLength(1);
    expect(segs[0].kwh).toBe(6);
  });

  it("écarte un segment à consommation négative", () => {
    const segs = buildSegments("prepaid", [r(0, 50), r(24, 60), r(48, 54)], []);
    expect(segs).toHaveLength(1);
    expect(segs[0].kwh).toBe(6);
  });

  it("donne une moyenne exacte quand la consommation est régulière", () => {
    const segs = buildSegments("prepaid", daily(8, 100, 5), []);
    expect(weightedAverage(segs, new Date(T0 + 7 * 24 * H))).toBeCloseTo(5, 6);
  });

  it("donne plus de poids aux jours récents", () => {
    // 4 jours à 4 kWh puis 4 jours à 8 kWh : la moyenne simple vaut 6.
    const readings = [r(0, 100)];
    let v = 100;
    for (let d = 1; d <= 8; d++) {
      v -= d <= 4 ? 4 : 8;
      readings.push(r(d * 24, v));
    }
    const avg = weightedAverage(buildSegments("prepaid", readings, []), new Date(T0 + 8 * 24 * H))!;
    expect(avg).toBeGreaterThan(6);
    expect(avg).toBeLessThan(8);
  });

  it("ignore les segments de plus de 30 jours", () => {
    const old = buildSegments("prepaid", [r(0, 100), r(24, 80)], []);
    expect(weightedAverage(old, new Date(T0 + 40 * 24 * H))).toBeNull();
  });
});

describe("phase d'apprentissage", () => {
  it("insuffisant avec 2 relevés", () => {
    expect(learningState([r(0, 50), r(48, 40)]).status).toBe("insufficient");
  });

  it("insuffisant avec 3 relevés sur une seule journée", () => {
    const s = learningState([r(0, 50), r(6, 49), r(12, 48)]);
    expect(s.status).toBe("insufficient");
    expect(s.daysNeeded).toBeGreaterThan(0);
  });

  it("préliminaire avec 3 relevés sur 2 jours, tolérance d'une heure comprise", () => {
    expect(learningState([r(0, 50), r(24, 45), r(47, 40)]).status).toBe("preliminary");
  });

  it("standard après 7 jours", () => {
    expect(learningState(daily(8, 100, 5)).status).toBe("standard");
  });

  it("indique combien de relevés manquent", () => {
    expect(learningState([r(0, 50)]).readingsNeeded).toBe(2);
  });
});

describe("prévision", () => {
  it("aucune date de coupure pendant l'apprentissage, mais un solde connu", () => {
    const f = computeForecast("prepaid", [r(0, 50), r(24, 45)], [], opts(24));
    expect(f.status).toBe("insufficient");
    expect(f.daysRemaining).toBeNull();
    expect(f.balanceKwh).toBe(45);
  });

  it("calcule les jours restants avec la marge de 20 %", () => {
    // 5 kWh/j, 30 kWh au dernier relevé, maintenant : 6 kWh/j prudents -> 5 jours.
    const readings = [r(0, 40), r(24, 35), r(48, 30)];
    const f = computeForecast("prepaid", readings, [], opts(48));
    expect(f.status).toBe("preliminary");
    expect(f.avgKwhDay).toBeCloseTo(5, 6);
    expect(f.daysRemaining).toBeCloseTo(5, 6);
    expect(new Date(f.cutoffAt!).getTime()).toBeCloseTo(T0 + (48 + 5 * 24) * H, -3);
  });

  it("déduit la consommation écoulée depuis le dernier relevé", () => {
    const readings = [r(0, 40), r(24, 35), r(48, 30)];
    const f = computeForecast("prepaid", readings, [], opts(72));
    expect(f.balanceKwh).toBeCloseTo(25, 6);
    expect(f.daysRemaining).toBeCloseTo(25 / 6, 6);
  });

  it("ajoute une recharge faite après le dernier relevé", () => {
    const readings = [r(0, 40), r(24, 35), r(48, 30)];
    const f = computeForecast("prepaid", readings, [rc(50, 30, 3300)], opts(50));
    expect(f.balanceKwh).toBeGreaterThan(55);
    expect(f.cycleKey).toBe("c50");
  });

  it("prix du kWh tiré des recharges, sinon prix par défaut", () => {
    const readings = [r(0, 40), r(24, 35), r(48, 30)];
    expect(computeForecast("prepaid", readings, [], opts(48)).priceKwh).toBe(110);
    const f = computeForecast("prepaid", readings, [rc(-24, 50, 5000)], opts(48));
    expect(f.priceKwh).toBe(100);
    expect(f.costPerDay).toBeCloseTo(500, 6);
  });

  it("postpayé : estimation sur 30 jours, sans date de coupure", () => {
    const readings = [r(0, 1000), r(24, 1008), r(48, 1016)];
    const f = computeForecast("postpaid", readings, [], opts(48));
    expect(f.avgKwhDay).toBeCloseTo(8, 6);
    expect(f.monthlyEstimateFcfa).toBeCloseTo(8 * 30 * 110, 6);
    expect(f.cutoffAt).toBeNull();
  });

  it("ignore un relevé daté dans le futur", () => {
    const f = computeForecast("prepaid", [r(0, 40), r(24, 35), r(48, 30), r(100, 1)], [], opts(48));
    expect(f.lastReading?.value).toBe(30);
  });

  it("solde nul : zéro jour restant", () => {
    const f = computeForecast("prepaid", [r(0, 10), r(24, 5), r(48, 0)], [], opts(48));
    expect(f.daysRemaining).toBe(0);
  });
});

describe("cycle de recharge", () => {
  it("« initial » sans recharge, sinon la dernière recharge", () => {
    expect(currentCycleKey([])).toBe("initial");
    expect(currentCycleKey([rc(10, 5, 500, "a"), rc(40, 5, 500, "b"), rc(20, 5, 500, "c")])).toBe("b");
  });
});

describe("anomalie", () => {
  it("détecte une consommation qui double", () => {
    const readings = [...daily(5, 100, 5), r(5 * 24, 100 - 4 * 5 - 11)];
    const segs = buildSegments("prepaid", readings, []);
    expect(detectAnomaly(segs, new Date(T0 + 5 * 24 * H), 2)).toBe(true);
  });

  it("ne signale rien sur une consommation régulière", () => {
    const segs = buildSegments("prepaid", daily(6, 100, 5), []);
    expect(detectAnomaly(segs, new Date(T0 + 5 * 24 * H), 2)).toBe(false);
  });

  it("ignore un dernier segment de moins de 12 h", () => {
    const readings = [...daily(5, 100, 5), r(4 * 24 + 6, 100 - 4 * 5 - 5)];
    const segs = buildSegments("prepaid", readings, []);
    expect(detectAnomaly(segs, new Date(T0 + 5 * 24 * H), 2)).toBe(false);
  });
});

describe("contrôles de cohérence", () => {
  const now = new Date(T0 + 72 * H);
  const hist = [r(0, 40), r(24, 35), r(48, 30)];

  it("refuse une valeur négative", () => {
    expect(checkReading("prepaid", { takenAt: at(72), value: -1 }, hist, [], now)[0].code).toBe("negative");
  });

  it("refuse une date future", () => {
    expect(checkReading("prepaid", { takenAt: at(80), value: 25 }, hist, [], now).map((c) => c.code)).toContain("future");
  });

  it("avertit d'un solde en hausse sans recharge", () => {
    const c = checkReading("prepaid", { takenAt: at(72), value: 45 }, hist, [], now);
    expect(c[0]).toMatchObject({ code: "balance_up", level: "warning" });
  });

  it("accepte un solde en hausse expliqué par une recharge", () => {
    expect(checkReading("prepaid", { takenAt: at(72), value: 45 }, hist, [rc(60, 20, 2200)], now)).toEqual([]);
  });

  it("avertit d'une chute anormale", () => {
    const c = checkReading("prepaid", { takenAt: at(72), value: 5 }, hist, [], now);
    expect(c[0]).toMatchObject({ code: "sharp_drop", level: "warning" });
  });

  it("accepte un relevé normal", () => {
    expect(checkReading("prepaid", { takenAt: at(72), value: 25 }, hist, [], now)).toEqual([]);
  });

  it("refuse un index postpayé en baisse", () => {
    const c = checkReading("postpaid", { takenAt: at(72), value: 990 }, [r(0, 1000)], [], now);
    expect(c[0]).toMatchObject({ code: "index_down", level: "error" });
  });
});

describe("jauge et historique", () => {
  it("couleurs de la jauge", () => {
    const th = { j5: 5, j2: 2 };
    expect(gaugeLevel(null, th)).toBe("unknown");
    expect(gaugeLevel(8, th)).toBe("green");
    expect(gaugeLevel(4, th)).toBe("amber");
    expect(gaugeLevel(1.5, th)).toBe("red");
  });

  it("répartit la consommation par jour calendaire", () => {
    const segs = buildSegments("prepaid", [r(-8, 50), r(16, 44)], []); // minuit à minuit
    const days = dailyConsumption(segs, 3, new Date(T0 + 16 * H));
    expect(days).toHaveLength(3);
    expect(days.map((d) => d.date)).toEqual(["2026-09-30", "2026-10-01", "2026-10-02"]);
    expect(days[1].kwh).toBeCloseTo(6, 6);
    expect(days[0].kwh).toBeNull();
    expect(days[2].kwh).toBeNull();
  });
});
