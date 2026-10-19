// Jauge des jours de courant restants (BF-11) : vert, ambre, rouge.
import type { GaugeLevel } from "@shared/prevision.ts";

const COLORS: Record<GaugeLevel, string> = {
  green: "#16a34a",
  amber: "#f59e0b",
  red: "#dc2626",
  unknown: "#d6d3d1",
};

export function Gauge({ days, level, max = 14, label }: { days: number | null; level: GaugeLevel; max?: number; label: string }) {
  const r = 84;
  const circumference = Math.PI * r; // demi-cercle
  const ratio = days === null ? 0 : Math.max(0, Math.min(1, days / max));
  const shown = days === null ? "–" : days < 1 ? "<1" : String(Math.floor(days));
  return (
    <div className="relative mx-auto w-full max-w-72" role="img" aria-label={label}>
      <svg viewBox="0 0 200 116" className="w-full">
        <path d="M16 100a84 84 0 0 1 168 0" fill="none" stroke="#f5f5f4" strokeWidth="18" strokeLinecap="round" />
        <path
          d="M16 100a84 84 0 0 1 168 0"
          fill="none"
          stroke={COLORS[level]}
          strokeWidth="18"
          strokeLinecap="round"
          strokeDasharray={`${circumference * ratio} ${circumference}`}
          style={{ transition: "stroke-dasharray 0.6s ease" }}
        />
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">
        <div className="tabular text-6xl leading-none font-extrabold text-stone-900">{shown}</div>
        <div className="mt-1 text-sm font-medium text-stone-500">{days !== null && days < 2 ? "jour restant" : "jours restants"}</div>
      </div>
    </div>
  );
}
