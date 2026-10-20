import { describe, expect, it } from "vitest";
import { type Bill, billPricing, estimateBill, latestBill } from "../supabase/functions/_shared/facture.ts";
import { isoWeekKey, weekday } from "../supabase/functions/_shared/temps.ts";

// Structure d'une facture CIE basse tension bimestrielle : 61 jours,
// 837 kWh, 69 905 FCFA dont 8 415 de part fixe (prime fixe + taxes).
const bill: Bill = {
  periodStart: "2026-08-04",
  periodEnd: "2026-10-04",
  indexStart: 28546,
  indexEnd: 29383,
  kwh: 837,
  amountFcfa: 69905,
  fixedFcfa: 8415,
};

const at = (iso: string) => new Date(iso);

describe("prix tirés de la facture", () => {
  it("sépare part fixe et prix réel du kWh", () => {
    const p = billPricing(bill);
    expect(p.fixedFcfa).toBe(8415);
    expect(p.priceKwh).toBeCloseTo(61490 / 837, 6);
  });

  it("sans part fixe connue, tout le montant est réparti au kWh", () => {
    expect(billPricing({ ...bill, fixedFcfa: null })).toEqual({ fixedFcfa: 0, priceKwh: 69905 / 837 });
  });

  it("retient la facture la plus récente", () => {
    const older = { ...bill, periodStart: "2026-06-04", periodEnd: "2026-08-04" };
    expect(latestBill([older, bill])?.periodEnd).toBe("2026-10-04");
    expect(latestBill([])).toBeNull();
  });
});

describe("estimation de la prochaine facture", () => {
  it("même consommation, même montant : on retrouve la facture", () => {
    const e = estimateBill([bill], [], 837 / 61, at("2026-10-20T12:00:00Z"))!;
    expect(e.basis).toBe("moyenne");
    expect(e.periodStart).toBe("2026-10-04");
    expect(e.periodEnd).toBe("2026-12-04");
    expect(e.amountFcfa).toBeCloseTo(69905, 0);
    expect(e.change).toBeCloseTo(0, 6);
  });

  it("utilise l'index exact depuis la facture", () => {
    // 220 kWh depuis le nouvel index en 16 jours, moyenne 15 kWh/j.
    const readings = [{ id: "r", takenAt: "2026-10-20T12:00:00Z", value: 29383 + 220 }];
    const e = estimateBill([bill], readings, 15, at("2026-10-20T12:00:00Z"))!;
    expect(e.basis).toBe("index");
    expect(e.consumedKwh).toBeCloseTo(220, 6);
    expect(e.projectedKwh).toBeCloseTo(220 + 15 * (61 - 16.5), 6);
    expect(e.amountFcfa).toBeCloseTo(8415 + e.projectedKwh * (61490 / 837), 6);
  });

  it("sans moyenne, au-delà d'une semaine de relevés : extrapole l'index seul", () => {
    const readings = [{ id: "r", takenAt: "2026-10-14T00:00:00Z", value: 29383 + 100 }];
    const e = estimateBill([bill], readings, null, at("2026-10-14T00:00:00Z"))!;
    expect(e.basis).toBe("index");
    expect(e.projectedKwh).toBeCloseTo(100 + 10 * (61 - 10), 6);
  });

  it("moins d'une semaine de relevés : lissé avec le rythme de la dernière facture", () => {
    // 60 kWh en 2,5 jours : 24 kWh/j bruts, mais 837 / 61 ≈ 13,7 kWh/j d'habitude.
    const readings = [{ id: "r", takenAt: "2026-10-06T12:00:00Z", value: 29383 + 60 }];
    const e = estimateBill([bill], readings, null, at("2026-10-06T12:00:00Z"))!;
    const rate = (60 + (837 / 61) * (7 - 2.5)) / 7;
    expect(e.projectedKwh).toBeCloseTo(60 + rate * (61 - 2.5), 6);
    expect(rate).toBeLessThan(24);
    expect(rate).toBeGreaterThan(837 / 61);
  });

  it("ignore un index plus bas que celui de la facture", () => {
    const readings = [{ id: "r", takenAt: "2026-10-20T00:00:00Z", value: 29000 }];
    expect(estimateBill([bill], readings, 14, at("2026-10-20T00:00:00Z"))!.basis).toBe("moyenne");
  });

  it("sans relevé ni moyenne : même consommation que la dernière facture", () => {
    const e = estimateBill([bill], [], null, at("2026-10-20T00:00:00Z"))!;
    expect(e.basis).toBe("derniere_facture");
    expect(e.projectedKwh).toBe(837);
  });

  it("une consommation en hausse se voit dans l'écart", () => {
    const e = estimateBill([bill], [], 20, at("2026-10-20T00:00:00Z"))!;
    expect(e.change).toBeGreaterThan(0.3);
  });

  it("factures intermédiaires oubliées : passe à la période en cours", () => {
    const e = estimateBill([bill], [], 14, at("2027-01-10T00:00:00Z"))!;
    expect(e.stale).toBe(true);
    expect(e.periodStart).toBe("2026-12-04");
  });

  it("aucune facture : pas d'estimation", () => {
    expect(estimateBill([], [], 14, at("2026-10-20T00:00:00Z"))).toBeNull();
  });
});

describe("calendrier", () => {
  it("jour de la semaine et semaine ISO", () => {
    expect(weekday("2026-10-19")).toBe(1); // lundi
    expect(isoWeekKey("2026-10-19")).toBe("2026-S43");
    expect(isoWeekKey("2026-01-01")).toBe("2026-S01");
    expect(isoWeekKey("2027-01-01")).toBe("2026-S53");
  });
});
