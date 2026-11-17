// Logo d'un moyen de paiement mobile (public/paiement/*.webp, 128 px).
// Moov Money n'a pas encore de logo : pastille de couleur avec l'initiale.
import { PAYMENT_LABELS, type PaymentMethod } from "@shared/validation.ts";

const LOGOS: Partial<Record<PaymentMethod, string>> = {
  wave: "/paiement/wave.webp",
  orange_money: "/paiement/orange_money.webp",
  mtn_momo: "/paiement/mtn_momo.webp",
};

/** Les moyens qui ont un logo, dans l'ordre d'affichage. */
export const LOGO_METHODS = ["wave", "orange_money", "mtn_momo"] as const satisfies readonly PaymentMethod[];

export function PaymentLogo({ method, className = "h-8 w-8", decorative = false }: { method: string; className?: string; decorative?: boolean }) {
  const src = LOGOS[method as PaymentMethod];
  const label = PAYMENT_LABELS[method as PaymentMethod] ?? method;
  if (!src) {
    return (
      <span className={`grid shrink-0 place-items-center rounded-lg bg-blue-700 text-xs font-bold text-white ${className}`} aria-hidden={decorative || undefined} role={decorative ? undefined : "img"} aria-label={decorative ? undefined : label}>
        {label.slice(0, 1)}
      </span>
    );
  }
  return (
    <img src={src} alt={decorative ? "" : label} width={128} height={128} decoding="async"
      className={`shrink-0 rounded-lg object-cover ring-1 ring-black/5 ${className}`} />
  );
}
