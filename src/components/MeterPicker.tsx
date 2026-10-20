import { useData } from "@/lib/data";
import { Icon } from "./icons";

/** Choix du compteur quand l'utilisateur en a plusieurs (les siens et ceux partagés). */
export function MeterPicker() {
  const { meters, selectedMeter, selectMeter, access } = useData();
  if (meters.length < 2) return null;
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="tablist" aria-label="Compteur">
      {meters.map((m) => {
        const active = m.id === selectedMeter?.id;
        const shared = access(m) !== "proprietaire";
        return (
          <button
            key={m.id}
            role="tab"
            aria-selected={active}
            onClick={() => selectMeter(m.id)}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold ${active ? "bg-brand-600 text-white shadow-md shadow-brand-600/25" : "bg-white text-stone-700 ring-1 ring-stone-200"}`}
          >
            {shared && <Icon name="users" className="h-4 w-4" />}
            {m.name}
            {shared && <span className="sr-only">(partagé)</span>}
          </button>
        );
      })}
    </div>
  );
}
