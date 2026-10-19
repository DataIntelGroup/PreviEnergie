import { useData } from "@/lib/data";

/** Choix du compteur quand l'utilisateur en a plusieurs. */
export function MeterPicker() {
  const { meters, selectedMeter, selectMeter } = useData();
  if (meters.length < 2) return null;
  return (
    <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4" role="tablist" aria-label="Compteur">
      {meters.map((m) => {
        const active = m.id === selectedMeter?.id;
        return (
          <button
            key={m.id}
            role="tab"
            aria-selected={active}
            onClick={() => selectMeter(m.id)}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold ${active ? "bg-brand-600 text-white" : "bg-white text-stone-700 ring-1 ring-stone-200"}`}
          >
            {m.name}
          </button>
        );
      })}
    </div>
  );
}
