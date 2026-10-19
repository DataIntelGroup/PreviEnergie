// Règles de saisie communes à l'application et au serveur.

/** 10 chiffres commençant par 01, 05, 07, 21, 25 ou 27 (BF-02). */
export const PHONE_RE = /^(01|05|07|21|25|27)\d{8}$/;

/** Retire espaces, points, tirets et l'indicatif +225 / 00225. */
export function normalizePhone(raw: string): string {
  let p = raw.replace(/[\s.\-()]/g, "");
  if (p.startsWith("+225")) p = p.slice(4);
  else if (p.startsWith("00225")) p = p.slice(5);
  return p;
}

export function isValidPhone(raw: string): boolean {
  return PHONE_RE.test(normalizePhone(raw));
}

/** 07 08 09 10 11 */
export function formatPhone(p: string): string {
  return p.replace(/(\d{2})(?=\d)/g, "$1 ");
}

export const PAYMENT_METHODS = ["wave", "orange_money", "mtn_momo", "moov_money", "carte", "especes", "autre"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  wave: "Wave",
  orange_money: "Orange Money",
  mtn_momo: "MTN MoMo",
  moov_money: "Moov Money",
  carte: "Carte bancaire",
  especes: "Espèces",
  autre: "Autre",
};

/** CinetPay n'accepte que des multiples de 5 FCFA. */
export function isCinetPayAmount(n: number): boolean {
  return Number.isInteger(n) && n > 0 && n % 5 === 0;
}

export const COMMUNES = [
  "Abobo", "Adjamé", "Anyama", "Attécoubé", "Bingerville", "Cocody", "Koumassi",
  "Marcory", "Plateau", "Port-Bouët", "Songon", "Treichville", "Yopougon",
  "Bouaké", "Daloa", "Korhogo", "San-Pédro", "Yamoussoukro", "Man", "Gagnoa",
  "Abengourou", "Grand-Bassam", "Divo", "Soubré", "Autre",
];
