// « As-tu été coupé ? » (BF-13) : mesure les coupures évitées.
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "./ui";

export function CutoffQuestion({
  meterId,
  cycleKey,
  question,
  onDone,
}: {
  meterId: string;
  cycleKey: string;
  question: string;
  onDone: (wasCut: boolean) => void;
}) {
  const [busy, setBusy] = useState<boolean | null>(null);
  async function answer(wasCut: boolean) {
    setBusy(wasCut);
    await supabase.from("cutoff_feedback").insert({ meter_id: meterId, cycle_key: cycleKey, was_cut: wasCut });
    setBusy(null);
    onDone(wasCut);
  }
  return (
    <div className="space-y-3">
      <p className="text-stone-700">{question}</p>
      <div className="grid grid-cols-2 gap-3">
        <Button variant="secondary" loading={busy === true} onClick={() => void answer(true)}>Oui, coupé</Button>
        <Button loading={busy === false} onClick={() => void answer(false)}>Non, pas coupé</Button>
      </div>
    </div>
  );
}
