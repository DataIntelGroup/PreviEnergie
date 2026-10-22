// Lecture des chiffres d'un reçu de recharge prépayée (Wave, Orange Money,
// MTN MoMo, Moov Money, agence CIE) ou d'une facture postpayée CIE, à partir
// du texte reconnu sur la photo, extrait du PDF ou collé depuis un SMS.
// Aucune IA ici : des règles sur des intitulés stables, et des contrôles
// arithmétiques pour savoir si la lecture est fiable.

export type ReceiptSource = "wave" | "orange_money" | "mtn_momo" | "moov_money" | "cie" | "inconnu";

export interface ReceiptBreakdown {
  energie: number | null;
  primeFixe: number | null;
  rti: number | null;
  rer: number | null;
  teom: number | null;
  tva: number | null;
  dette: number | null;
  /** Redevance de branchement : remboursement du branchement, prélevé à chaque recharge. */
  branchement: number | null;
}

export interface ReceiptRead {
  source: ReceiptSource;
  /** Recharge prépayée, ou paiement d'une facture postpayée (aucun kWh, aucun code). */
  kind: "recharge" | "paiement_facture" | "inconnu";
  amountFcfa: number | null;
  kwh: number | null;
  /** Code de recharge, 20 chiffres par groupes de 4. */
  code: string | null;
  /** Instant ISO (heure d'Abidjan = UTC). */
  date: string | null;
  meterNumber: string | null;
  breakdown: ReceiptBreakdown;
  /** Énergie + prime fixe + taxes = montant payé : la lecture est juste. */
  consistent: boolean | null;
  /** Nombre de champs essentiels trouvés, de 0 à 4 (montant, kWh, code, date). */
  found: number;
}

export interface BillRead {
  periodStart: string | null; // AAAA-MM-JJ
  periodEnd: string | null;
  indexStart: number | null;
  indexEnd: number | null;
  kwh: number | null;
  amountFcfa: number | null;
  /** Prime fixe TTC + autres taxes : la part de la facture qui ne dépend pas des kWh. */
  fixedFcfa: number | null;
  dueDate: string | null;
  /** Nouvel index − ancien index = consommation : les index sont bien lus. */
  indexConsistent: boolean | null;
  found: number;
}

// ---------------------------------------------------------------- outils

const MONTHS: Record<string, number> = {
  janv: 1, jan: 1, janvier: 1,
  fevr: 2, fev: 2, fevrier: 2,
  mars: 3, mar: 3,
  avr: 4, avril: 4,
  mai: 5,
  juin: 6,
  juil: 7, juillet: 7,
  aout: 8,
  sept: 9, sep: 9, septembre: 9,
  oct: 10, octobre: 10,
  nov: 11, novembre: 11,
  dec: 12, decembre: 12,
};

/** Minuscules sans accents, espaces insécables normalisés. */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[   ]/g, " ")
    .toLowerCase();
}

/**
 * Montant écrit à la française ou à l'anglaise : « 5.000F », « 3.902,40F »,
 * « 5 000 FCFA », « 69 905 », « 594,04 ».
 */
export function parseAmount(raw: string): number | null {
  let s = raw.replace(/[  \s]/g, "").replace(/f(cfa)?$/i, "").replace(/[^\d.,-]/g, "");
  if (!/\d/.test(s)) return null;
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, ""); // 5.000 = cinq mille
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Nombre décimal simple : « 91.4 », « 91,4 ». */
function parseDecimal(raw: string): number | null {
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

const pad = (n: number) => String(n).padStart(2, "0");

function isoFrom(y: number, m: number, d: number, h = 0, min = 0): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || h > 23 || min > 59) return null;
  const iso = `${y}-${pad(m)}-${pad(d)}T${pad(h)}:${pad(min)}:00.000Z`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** « 2026-09-26 16:19:25 », « 8 déc. 2024 5:55 PM », « 24-09-2026 ,20:00 », « 04/10/2020 ». */
export function parseDateTime(text: string): string | null {
  const t = normalize(text);
  // Date et heure informatiques (SMS de la CIE) : la plus précise, prioritaire
  // sur une date écrite dans le texte d'information en bas du message.
  const iso = /(?<!\d)(\d{4})-(\d{2})-(\d{2})[ t](\d{2}):(\d{2})/.exec(t);
  if (iso) {
    const v = isoFrom(Number(iso[1]), Number(iso[2]), Number(iso[3]), Number(iso[4]), Number(iso[5]));
    if (v) return v;
  }
  const fr = /(\d{1,2})\s+([a-z]{3,9})\.?\s+(\d{4})(?:[\s,]+(?:a\s+)?(\d{1,2})\s*[:h]\s*(\d{2})\s*(am|pm)?)?/.exec(t);
  if (fr && MONTHS[fr[2]]) {
    let h = fr[4] ? Number(fr[4]) : 0;
    if (fr[6] === "pm" && h < 12) h += 12;
    if (fr[6] === "am" && h === 12) h = 0;
    const iso = isoFrom(Number(fr[3]), MONTHS[fr[2]], Number(fr[1]), h, fr[5] ? Number(fr[5]) : 0);
    if (iso) return iso;
  }
  const num = /(\d{2})[-/.](\d{2})[-/.](\d{4})(?:\s*,?\s*(?:a\s+)?(\d{1,2})\s*[:h]\s*(\d{2}))?/.exec(t);
  if (num) return isoFrom(Number(num[3]), Number(num[2]), Number(num[1]), num[4] ? Number(num[4]) : 0, num[5] ? Number(num[5]) : 0);
  return null;
}

/** Lignes non vides, normalisées. */
function lines(text: string): string[] {
  return normalize(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/** Montant écrit sur la ligne de l'intitulé, sinon sur la suivante. */
function amountAfter(ls: string[], label: RegExp): number | null {
  for (let i = 0; i < ls.length; i++) {
    const m = label.exec(ls[i]);
    if (!m) continue;
    const rest = ls[i].slice(m.index + m[0].length);
    const onLine = /(-?\d[\d .,]*\d|\d)\s*(f\s*cfa|fcfa|f)?\b/.exec(rest);
    if (onLine) return parseAmount(onLine[1]);
    if (i + 1 < ls.length) {
      const next = /^(-?\d[\d .,]*\d|\d)\s*(f\s*cfa|fcfa|f)?\b/.exec(ls[i + 1]);
      if (next) return parseAmount(next[1]);
    }
  }
  return null;
}

// ---------------------------------------------------------------- reçu de recharge

function detectSource(t: string): ReceiptSource {
  if (/\bwave\b/.test(t)) return "wave";
  if (/orange\s*money|billpay|\bmp\d{6}\./.test(t)) return "orange_money";
  if (/\bmtn\b|momo/.test(t)) return "mtn_momo";
  if (/\bmoov\b|flooz/.test(t)) return "moov_money";
  // SMS envoyé par la CIE après un achat : « Code rechargement », « Redevance brch ».
  if (/\bcie\b|compagnie ivoirienne|code rechargement|redevance br/.test(t)) return "cie";
  return "inconnu";
}

/** Code de recharge : 20 chiffres, éventuellement par groupes et sur deux lignes. */
export function findRechargeCode(text: string): string | null {
  const t = normalize(text);
  // De préférence juste après l'intitulé « code ».
  const near = /code[^\d]{0,40}((?:\d[\s-]*){20})/.exec(t);
  const any = near ?? /(?<!\d)((?:\d{4}[\s-]+){4}\d{4})(?!\d)/.exec(t);
  if (!any) return null;
  const digits = any[1].replace(/\D/g, "").slice(0, 20);
  if (digits.length !== 20) return null;
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ");
}

export function parseReceiptText(text: string): ReceiptRead {
  const t = normalize(text);
  const ls = lines(text);
  const source = detectSource(t);

  // « kWh: 226.87 » (SMS CIE) d'abord, sinon « 91,8 kWh » sur la même ligne :
  // sans cette précaution, le nombre de la ligne au-dessus serait pris.
  const kwhMatch = /\bk\s*w\s*h\s*:\s*(\d+(?:[.,]\d+)?)/.exec(t) ?? /(\d+(?:[.,]\d+)?)[ \t]*k\s*w\s*h/.exec(t);
  const kwh = kwhMatch ? parseDecimal(kwhMatch[1]) : null;
  const code = findRechargeCode(text);
  const date = parseDateTime(ls.find((l) => /date/.test(l)) ?? "") ?? parseDateTime(t);
  const meter = /(?:numero de compteur|n[°o]\s*compteur|compteur|\bctr)\s*:?\s*(\d{8,13})\b/.exec(t);

  // Montant payé : intitulé « montant » (transféré, payé…), sinon « total ».
  const amountFcfa =
    amountAfter(ls, /\bmontant(?! du transfert)(\s+(paye|transfere|total))?\s*:?/) ??
    amountAfter(ls, /montant du transfert\s*:?/) ??
    amountAfter(ls, /\btotal\b\s*:?/);

  const breakdown: ReceiptBreakdown = {
    energie: amountAfter(ls, /(cout de l.?energie|\bmt energie|montant energie)\s*:?/),
    primeFixe: amountAfter(ls, /prime fixe\s*:?/),
    rti: amountAfter(ls, /\br-?\s?rti\b\s*:?/),
    rer: amountAfter(ls, /\brer\b\s*:?/),
    teom: amountAfter(ls, /\bteom\b\s*:?/),
    tva: amountAfter(ls, /\btva\b\s*:?/),
    dette: amountAfter(ls, /dette[^\d]*:?/),
    branchement: amountAfter(ls, /redevance (de )?br(anchement|ch)\.?\s*:?/),
  };

  // Sur les reçus CIE, énergie + prime fixe + RTI + RER + TEOM (+ dette,
  // + redevance de branchement) = montant payé ; la TVA est déjà comprise.
  let consistent: boolean | null = null;
  if (amountFcfa !== null && breakdown.energie !== null) {
    const parts = [breakdown.energie, breakdown.primeFixe, breakdown.rti, breakdown.rer, breakdown.teom, breakdown.dette, breakdown.branchement];
    const sum = parts.reduce<number>((s, v) => s + (v ?? 0), 0);
    consistent = Math.abs(sum - amountFcfa) <= 1;
  }

  const billPayment = /billpay|paiement de facture|facture/.test(t) && kwh === null && code === null;
  const kind = kwh !== null || code !== null ? "recharge" : billPayment ? "paiement_facture" : "inconnu";
  const found = [amountFcfa, kwh, code, date].filter((v) => v !== null).length;

  return {
    source,
    kind,
    amountFcfa,
    kwh,
    code,
    date,
    meterNumber: meter ? meter[1] : null,
    breakdown,
    consistent,
    found,
  };
}

// ---------------------------------------------------------------- facture postpayée CIE

/**
 * Les montants d'une facture CIE sont écrits « 28 546 29 383 837 » : les
 * espaces séparent à la fois les milliers et les colonnes. On essaie tous
 * les regroupements possibles (un groupe suivant de 3 chiffres peut être des
 * milliers) et on garde celui qui vérifie la règle donnée.
 */
export function groupings(tokens: string[]): number[][] {
  const out: number[][] = [];
  const walk = (i: number, acc: number[]) => {
    if (i === tokens.length) {
      out.push(acc);
      return;
    }
    let s = tokens[i];
    walk(i + 1, [...acc, Number(s)]);
    for (let j = i + 1; j < tokens.length && tokens[j].length === 3 && s.length < 9; j++) {
      s += tokens[j];
      walk(j + 1, [...acc, Number(s)]);
    }
  };
  if (tokens.length <= 12) walk(0, []);
  return out;
}

const digitTokens = (line: string) => line.match(/\d+/g) ?? [];

/** Ancien index, nouvel index, différence : la ligne où nouveau − ancien = différence. */
function findIndexes(ls: string[]): { start: number; end: number; diff: number } | null {
  let best: { start: number; end: number; diff: number } | null = null;
  for (const l of ls) {
    const tokens = digitTokens(l.replace(/\d{2}\/\d{2}\/\d{4}/g, " "));
    if (tokens.length < 3) continue;
    for (const g of groupings(tokens)) {
      for (let i = 0; i + 2 < g.length; i++) {
        const [a, b, c] = [g[i], g[i + 1], g[i + 2]];
        if (a >= 100 && b > a && c > 0 && b - a === c && (!best || a > best.start)) best = { start: a, end: b, diff: c };
      }
    }
  }
  return best;
}

/** Ligne « Prime fixe » : HT, taux, TVA, TTC. On retient le TTC (HT + TVA = TTC). */
function findPrimeFixeTtc(ls: string[]): number | null {
  const l = ls.find((x) => /prime fixe/.test(x));
  if (!l) return null;
  const tokens = digitTokens(l);
  for (const g of groupings(tokens)) {
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) {
        for (let k = j + 1; k < g.length; k++) {
          if (g[i] > 0 && g[j] > 0 && g[i] + g[j] === g[k] && g[j] < g[i]) return g[k];
        }
      }
    }
  }
  return null;
}

/** Dernier nombre d'une ligne, milliers recollés : « Redevance RTI 2 000 » → 2000. */
function lastAmount(line: string): number | null {
  const tokens = digitTokens(line);
  if (!tokens.length) return null;
  // On recolle vers la gauche tant que le groupe courant fait 3 chiffres
  // (des milliers) : « 69 905 » → 69905, « 1 234 567 » → 1234567.
  let i = tokens.length - 1;
  let s = tokens[i];
  while (i > 0 && tokens[i].length === 3 && tokens[i - 1].length <= 3 && s.length < 9) {
    s = tokens[i - 1] + s;
    i--;
  }
  return Number(s);
}

const OTHER_TAXES = [/electrification rurale/, /ordures menageres/, /redevance rti/, /timbre/];

export function parseBillText(text: string): BillRead {
  const t = normalize(text);
  const ls = lines(text);

  const period = /du\s*:?\s*(\d{2})[/.-](\d{2})[/.-](\d{4})\s*au\s*:?\s*(\d{2})[/.-](\d{2})[/.-](\d{4})/.exec(t);
  const periodStart = period ? `${period[3]}-${period[2]}-${period[1]}` : null;
  const periodEnd = period ? `${period[6]}-${period[5]}-${period[4]}` : null;

  const idx = findIndexes(ls);
  const kwhLine = ls.find((l) => /consommation enregistree|consommation \(kwh\)/.test(l));
  const kwh = idx?.diff ?? (kwhLine ? lastAmount(kwhLine) : null);

  const totalLine = ls.find((l) => /total facture/.test(l)) ?? ls.find((l) => /montant total a regler/.test(l));
  const amountFcfa = totalLine ? lastAmount(totalLine) : null;

  const prime = findPrimeFixeTtc(ls);
  const taxes = OTHER_TAXES.map((re) => {
    const l = ls.find((x) => re.test(x));
    return l ? lastAmount(l) : null;
  });
  const taxSum = taxes.reduce<number>((s, v) => s + (v ?? 0), 0);
  const fixedFcfa = prime !== null || taxSum > 0 ? (prime ?? 0) + taxSum : null;

  const due = /date limite[^\d]*(\d{2})[/.-](\d{2})[/.-](\d{4})/.exec(t);
  const dueDate = due ? `${due[3]}-${due[2]}-${due[1]}` : null;

  const read: BillRead = {
    periodStart,
    periodEnd,
    indexStart: idx?.start ?? null,
    indexEnd: idx?.end ?? null,
    kwh,
    amountFcfa,
    fixedFcfa: fixedFcfa !== null && amountFcfa !== null && fixedFcfa >= amountFcfa ? null : fixedFcfa,
    dueDate,
    indexConsistent: idx ? true : null,
    found: 0,
  };
  read.found = [read.periodStart, read.kwh, read.amountFcfa, read.indexEnd].filter((v) => v !== null).length;
  return read;
}
