// Histogramme SVG léger (pas de bibliothèque de graphiques : l'app reste petite).
import { useState } from "react";

export interface Bar {
  label: string;
  /** Libellé complet affiché au survol ou au toucher. */
  title: string;
  value: number | null;
}

export function BarChart({
  bars,
  format,
  height = 160,
  color = "#ea580c",
  emptyText = "Pas encore de données",
}: {
  bars: Bar[];
  format: (v: number) => string;
  height?: number;
  color?: string;
  emptyText?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const values = bars.map((b) => b.value ?? 0);
  const max = Math.max(...values, 0);
  if (max <= 0) {
    return <div className="flex items-center justify-center rounded-xl bg-stone-50 text-sm text-stone-500" style={{ height }}>{emptyText}</div>;
  }
  const w = 100 / bars.length;
  const labelEvery = Math.ceil(bars.length / 7);
  const sel = active !== null ? bars[active] : null;
  return (
    <div>
      <div className="mb-2 h-5 text-sm text-stone-600" aria-live="polite">
        {sel ? (
          <>
            <span className="font-medium text-stone-900">{sel.title}</span> · {sel.value === null ? "pas de relevé" : format(sel.value)}
          </>
        ) : (
          <>Maximum : {format(max)}</>
        )}
      </div>
      <svg viewBox={`0 0 100 ${height / 2}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img" aria-label="Histogramme">
        {bars.map((b, i) => {
          const h = ((b.value ?? 0) / max) * (height / 2 - 2);
          return (
            <g key={i} onMouseEnter={() => setActive(i)} onClick={() => setActive(i)} onMouseLeave={() => setActive(null)}>
              <rect x={i * w} y={0} width={w} height={height / 2} fill="transparent" />
              <rect
                x={i * w + w * 0.15}
                y={height / 2 - h}
                width={w * 0.7}
                height={Math.max(h, b.value === null ? 0 : 0.5)}
                rx={Math.min(1.5, w * 0.2)}
                fill={b.value === null ? "#e7e5e4" : color}
                opacity={active === null || active === i ? 1 : 0.45}
              />
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex text-[11px] text-stone-500">
        {bars.map((b, i) => (
          <span key={i} className="text-center" style={{ width: `${w}%` }}>
            {i % labelEvery === 0 ? b.label : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
