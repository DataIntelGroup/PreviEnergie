// Journal d'audit des actions (BF-32).
import { useEffect, useState } from "react";
import { Button, Card, Spinner } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { supabase } from "@/lib/supabase";

interface Entry {
  id: number;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

const ACTIONS: Record<string, string> = {
  "user.update": "Utilisateur modifié",
  "setting.update": "Réglage modifié",
  "plan.update": "Offre modifiée",
  "plan.expire": "Offres expirées",
  "payment.accepted": "Paiement accepté",
  "account.delete": "Compte supprimé",
};

const PAGE = 50;

export default function Journal() {
  const [rows, setRows] = useState<Entry[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(true);
  const [open, setOpen] = useState<number | null>(null);

  async function load(before?: number) {
    setLoading(true);
    let q = supabase.from("audit_log").select("*").order("id", { ascending: false }).limit(PAGE);
    if (before) q = q.lt("id", before);
    const { data } = await q;
    const list = (data as Entry[]) ?? [];
    setRows((r) => (before ? [...r, ...list] : list));
    setMore(list.length === PAGE);
    const ids = [...new Set(list.flatMap((e) => [e.actor_id, e.target_type === "profile" ? e.target_id : null]).filter(Boolean))] as string[];
    if (ids.length) {
      const { data: ps } = await supabase.from("profiles").select("id, first_name, last_name, email").in("id", ids);
      setNames((n) => ({
        ...n,
        ...Object.fromEntries((ps ?? []).map((p) => [p.id, `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || p.email || p.id])),
      }));
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-2xl font-bold">Journal</h1>
      <Card className="p-0">
        <ul className="divide-y divide-stone-100">
          {rows.map((e) => (
            <li key={e.id} className="px-4 py-3 text-sm">
              <button className="flex w-full flex-wrap items-baseline justify-between gap-2 text-left" onClick={() => setOpen(open === e.id ? null : e.id)}>
                <span>
                  <span className="font-medium">{ACTIONS[e.action] ?? e.action}</span>
                  {e.target_type === "profile" && e.target_id && <span className="text-stone-600"> · {names[e.target_id] ?? "compte supprimé"}</span>}
                  {e.target_type === "setting" && <span className="text-stone-600"> · {e.target_id}</span>}
                  {e.target_type === "plan" && <span className="text-stone-600"> · {e.target_id}</span>}
                </span>
                <span className="text-stone-500">{e.actor_id ? names[e.actor_id] ?? "?" : "Système"} · {fmtDateTime(e.created_at)}</span>
              </button>
              {open === e.id && <pre className="mt-2 overflow-x-auto rounded-lg bg-stone-50 p-3 text-xs text-stone-700">{JSON.stringify(e.details, null, 2)}</pre>}
            </li>
          ))}
          {rows.length === 0 && !loading && <li className="px-4 py-10 text-center text-stone-500">Aucune action enregistrée.</li>}
        </ul>
        {loading && <div className="flex justify-center py-6 text-brand-600"><Spinner /></div>}
      </Card>
      {more && !loading && rows.length > 0 && (
        <Button variant="secondary" className="w-full" loading={loading} onClick={() => void load(rows.at(-1)!.id)}>Plus ancien</Button>
      )}
    </div>
  );
}
