// Jauge des jours de courant restants (BF-11) : vert, ambre, rouge.
// `onColor` : version blanche, posée sur la carte orange de l'accueil.
import type { GaugeLevel } from "@shared/prevision.ts";

const COLORS: Record<GaugeLevel, string> = {
  green: "#16a34a",
  amber: "#f59e0b",
  red: "#dc2626",
  unknown: "#d6d3d1",
};

// Sur fond orange, l'ambre et le rouge se confondent avec le fond : on garde
// le blanc pour l'arc et on signale le niveau par la pastille de statut.
const ON_COLOR: Record<GaugeLevel, string> = {
  green: "#ffffff",
  amber: "#ffffff",
  red: "#ffffff",
  unknown: "rgba(255,255,255,0.35)",
};

export function Gauge({
  days,
  level,
  max = 14,
  label,
  onColor = false,
  size = "md",
}: {
  days: number | null;
  level: GaugeLevel;
  max?: number;
  label: string;
  onColor?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const r = 84;
  const circumference = Math.PI * r; // demi-cercle
  const ratio = days === null ? 0 : Math.max(0, Math.min(1, days / max));
  const shown = days === null ? "–" : days < 1 ? "<1" : String(Math.floor(days));
  const width = { sm: "max-w-44", md: "max-w-72", lg: "max-w-80" }[size];
  const number = { sm: "text-4xl", md: "text-6xl", lg: "text-7xl" }[size];
  return (
    <div className={`relative mx-auto w-full ${width}`} role="img" aria-label={label}>
      <svg viewBox="0 0 200 116" className="w-full">
        <path d="M16 100a84 84 0 0 1 168 0" fill="none" stroke={onColor ? "rgba(255,255,255,0.2)" : "#f5f5f4"} strokeWidth="18" strokeLinecap="round" />
        {ratio > 0 && (
          <path
            d="M16 100a84 84 0 0 1 168 0"
            fill="none"
            stroke={onColor ? ON_COLOR[level] : COLORS[level]}
            strokeWidth="18"
            strokeLinecap="round"
            strokeDasharray={`${circumference * ratio} ${circumference}`}
            style={{ transition: "stroke-dasharray 0.8s ease" }}
          />
        )}
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">
        <div className={`tabular ${number} leading-none font-extrabold ${onColor ? "text-white" : "text-stone-900"}`}>{shown}</div>
        <div className={`mt-1 text-sm font-medium ${onColor ? "text-white/80" : "text-stone-500"}`}>
          {days !== null && days < 2 ? "jour restant" : "jours restants"}
        </div>
      </div>
    </div>
  );
}
