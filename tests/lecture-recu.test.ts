import { describe, expect, it } from "vitest";
import {
  findRechargeCode,
  groupings,
  parseAmount,
  parseBillText,
  parseDateTime,
  parseReceiptText,
} from "../supabase/functions/_shared/lecture-recu.ts";

// Textes calqués sur la mise en page réelle des reçus (tels que Tesseract les
// rend), avec des valeurs inventées : aucune donnée personnelle ici.
const WAVE = `B wave
Reçu de Transaction
Aperçu
Type de transaction Paiement
Marchand Prépayé CIE
Montant 4.000F
Acheteur Prénom N
01 02 03 04 05
Détails
Statut Effectué
Frais OF
Date et heure 17 sept. 2025 11:32 PM
Code de recharge 1111 2222 3333
4444 5555
Numéro de compteur 12345678901
Référence 9990001112223
Quantité d'énergie 73.2 kWh
PRIME FIXE 475,22F
R-RTI 146,22F
RER 73,84F
TEOM 182,78F
TVA 238,36F
Règlement Dette Branchement 0,00F
Coût de l'énergie 3.121,94F
Référence de transaction 0123456789
0123456789
ID de la Transaction Wave T_ABCDEFG
En partenariat avec UBA`;

const ORANGE_FACTURE = `Montant transféré
5000 FCFA
Détails du bénéficiaire
Numéro
0100000000
Détail de la transaction
Expéditeur
0700000000
Date
24-09-2026 ,20:00
Type de service
BILLPAY
Référence
MP260924.2000.B00000
Compte
Principal
Montant du transfert
5000 FCFA`;

const CIE_FACTURE = `COMPAGNIE IVOIRIENNE D'ELECTRICITE
FACTURE D'ELECTRICITE BASSE TENSION N° 173 PERIODE 10/2026
Consommation du : 04/08/2026 au : 04/10/2026 Date limite de paiement : 05/11/2026
RELEVE COMPTEUR INDEX
NUMERO ANCIEN NOUVEAU DIFFERENCE COEFFICIENT CONSOMMATION
021 13121542 30 100 30 900 800 1,0 800
Tranches Consommation PRIX Unitaire HT Montant HT Taux TVA Montant TVA Montant TTC
1 396 66,96 26 515 18 4 775 31 290
2 404 58,04 23 448 18 4 221 27 669
Prime fixe 2 740 18 495 3 235
Total Energie Facturé 52 703 9 491 62 194
Redevance Electrification Rurale 985
Taxe Rémunératoire pour l'Enlèvement des Ordures Ménagères 2 920
Redevance RTI 2 000
Timbre d'Etat (*) 100
TOTAL FACTURE (Fcfa) 68 199
MONTANT TOTAL A REGLER (Fcfa) 68 199`;

describe("montants", () => {
  it("écritures française et anglaise", () => {
    expect(parseAmount("5.000F")).toBe(5000);
    expect(parseAmount("3.902,40F")).toBe(3902.4);
    expect(parseAmount("5 000 FCFA")).toBe(5000);
    expect(parseAmount("594,04")).toBe(594.04);
    expect(parseAmount("91.4")).toBe(91.4);
    expect(parseAmount("12 500 F")).toBe(12500);
    expect(parseAmount("—")).toBeNull();
  });

  it("regroupements possibles d'une ligne de facture", () => {
    const g = groupings(["30", "100", "30", "900", "800"]).map((x) => x.join(","));
    expect(g).toContain("30100,30900,800");
  });
});

describe("dates", () => {
  it("format Wave, 12 h", () => {
    expect(parseDateTime("Date et heure 17 sept. 2025 11:32 PM")).toBe("2025-09-17T23:32:00.000Z");
    expect(parseDateTime("8 déc. 2024 5:55 AM")).toBe("2024-12-08T05:55:00.000Z");
    expect(parseDateTime("1 janv. 2026 12:10 AM")).toBe("2026-01-01T00:10:00.000Z");
  });

  it("format Orange Money et numérique", () => {
    expect(parseDateTime("24-09-2026 ,20:00")).toBe("2026-09-24T20:00:00.000Z");
    expect(parseDateTime("le 05/11/2026")).toBe("2026-11-05T00:00:00.000Z");
  });

  it("date impossible : rien", () => {
    expect(parseDateTime("32/13/2026")).toBeNull();
  });
});

describe("code de recharge", () => {
  it("20 chiffres sur deux lignes", () => {
    expect(findRechargeCode("Code de recharge 1111 2222 3333\n4444 5555")).toBe("1111 2222 3333 4444 5555");
  });

  it("avec tirets, sans intitulé", () => {
    expect(findRechargeCode("Votre code 1234-5678-9012-3456-7890 merci")).toBe("1234 5678 9012 3456 7890");
  });

  it("pas de faux code dans une référence trop courte", () => {
    expect(findRechargeCode("Référence 2220940250200")).toBeNull();
  });
});

describe("reçu Wave", () => {
  const r = parseReceiptText(WAVE);

  it("trouve montant, kWh, code et date", () => {
    expect(r.source).toBe("wave");
    expect(r.kind).toBe("recharge");
    expect(r.amountFcfa).toBe(4000);
    expect(r.kwh).toBe(73.2);
    expect(r.code).toBe("1111 2222 3333 4444 5555");
    expect(r.date).toBe("2025-09-17T23:32:00.000Z");
    expect(r.meterNumber).toBe("12345678901");
    expect(r.found).toBe(4);
  });

  it("lit le détail et vérifie que le compte est bon", () => {
    expect(r.breakdown).toMatchObject({ energie: 3121.94, primeFixe: 475.22, rti: 146.22, rer: 73.84, teom: 182.78, tva: 238.36, dette: 0 });
    expect(r.consistent).toBe(true);
  });

  it("une erreur de lecture sur un chiffre fait échouer le contrôle", () => {
    expect(parseReceiptText(WAVE.replace("3.121,94F", "3.721,94F")).consistent).toBe(false);
  });

  it("le « O » lu à la place d'un zéro dans les frais ne gêne pas", () => {
    expect(r.amountFcfa).toBe(4000);
  });
});

describe("reçu Orange Money de paiement de facture", () => {
  const r = parseReceiptText(ORANGE_FACTURE);

  it("reconnu comme paiement de facture, sans kWh ni code", () => {
    expect(r.source).toBe("orange_money");
    expect(r.kind).toBe("paiement_facture");
    expect(r.amountFcfa).toBe(5000);
    expect(r.date).toBe("2026-09-24T20:00:00.000Z");
    expect(r.kwh).toBeNull();
    expect(r.code).toBeNull();
  });
});

describe("SMS de recharge collé", () => {
  it("lit les éléments d'un SMS", () => {
    const r = parseReceiptText("Orange Money: Achat CIE prepaye. Montant: 5000 FCFA. Energie: 45,2 kWh. Code: 1234-5678-9012-3456-7890. Le 12/10/2026 a 14h05.");
    expect(r).toMatchObject({ source: "orange_money", kind: "recharge", amountFcfa: 5000, kwh: 45.2, code: "1234 5678 9012 3456 7890", date: "2026-10-12T14:05:00.000Z" });
  });

  it("texte sans rapport : rien de trouvé", () => {
    const r = parseReceiptText("Bonjour, rendez-vous demain.");
    expect(r.found).toBe(0);
    expect(r.kind).toBe("inconnu");
  });
});

// SMS de la CIE après un achat, tel que l'OCR le lit sur une capture d'écran
// d'iPhone (valeurs inventées, même présentation que le vrai message).
const SMS_CIE = `Code rechargement: 1111 2222
3333 4444 5555

Ctr: 12345678901

Ref: 0400000000001

Mt Energie: 9585.09

Prime fixe: 1045.40

R-RTI: 340.30

RER: 147.47

TEOM: 283.59

kWh: 113.44

Redevance brch: 3598.15

Total général: 15000 dont TVA
1621.60

Recu: 0a1b2c3d4e

2026-10-02 08:41:07

<< Cher client, les nouveaux
tarifs de l'électricité sont en
vigueur depuis le 07 janvier 2024.
Plus d'info au 179 >>`;

describe("SMS de la CIE (capture d'écran)", () => {
  const r = parseReceiptText(SMS_CIE);

  it("kWh de la ligne « kWh: », pas le nombre de la ligne au-dessus", () => {
    expect(r.kwh).toBe(113.44);
  });

  it("date du message, pas celle du texte d'information", () => {
    expect(r.date).toBe("2026-10-02T08:41:00.000Z");
  });

  it("montant, code, compteur et source", () => {
    expect(r).toMatchObject({ source: "cie", kind: "recharge", amountFcfa: 15000, code: "1111 2222 3333 4444 5555", meterNumber: "12345678901", found: 4 });
  });

  it("détail avec la redevance de branchement : le compte tombe juste", () => {
    expect(r.breakdown).toMatchObject({ energie: 9585.09, primeFixe: 1045.4, rti: 340.3, rer: 147.47, teom: 283.59, branchement: 3598.15, tva: 1621.6 });
    expect(r.consistent).toBe(true);
  });

  it("sans la redevance de branchement, le contrôle échouerait", () => {
    expect(parseReceiptText(SMS_CIE.replace("Redevance brch: 3598.15", "")).consistent).toBe(false);
  });
});

describe("facture postpayée CIE", () => {
  const b = parseBillText(CIE_FACTURE);

  it("période, index, consommation et total", () => {
    expect(b.periodStart).toBe("2026-08-04");
    expect(b.periodEnd).toBe("2026-10-04");
    expect(b.indexStart).toBe(30100);
    expect(b.indexEnd).toBe(30900);
    expect(b.kwh).toBe(800);
    expect(b.amountFcfa).toBe(68199);
    expect(b.indexConsistent).toBe(true);
    expect(b.dueDate).toBe("2026-11-05");
  });

  it("part fixe = prime fixe TTC + autres taxes", () => {
    expect(b.fixedFcfa).toBe(3235 + 985 + 2920 + 2000 + 100);
  });

  it("texte illisible : rien d'inventé", () => {
    const empty = parseBillText("xx ## 12 ?? illisible");
    expect(empty).toMatchObject({ periodStart: null, kwh: null, amountFcfa: null, fixedFcfa: null, found: 0 });
  });
});
