// Relances : message de l'équipe à un groupe de clients (essai qui se
// termine, lecture seule, offre qui expire, sans relevé…), par notification
// push et/ou email, avec l'historique des envois.
import { type Segment, SEGMENTS } from "@shared/segments.ts";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "@/components/icons";
import { Card, Notice, Spinner } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { callFunction, supabase } from "@/lib/supabase";
import { useAdmin } from "./AdminApp";
import { MessageComposer, type SendStats } from "./Messages";

const ICONS: Record<Segment, IconName> = {
  essai_fin: "clock",
  expire: "lock",
  renouvellement: "wallet",
  inactifs: "camera",
  essai: "sparkles",
  abonnes: "shield",
  tous: "users",
};
const ORDER: Segment[] = ["essai_fin", "expire", "renouvellement", "inactifs", "essai", "abonnes", "tous"];

interface Counts {
  counts: Record<Segment, { recipients: number; withPush: number }>;
  available: string[];
}
interface Sent {
  id: number;
  target_id: string;
  created_at: string;
  details: SendStats & { title: string; channels: string[] };
}

export default function Relances() {
  const { isAdmin } = useAdmin();
  const [segment, setSegment] = useState<Segment>("essai_fin");
  const [counts, setCounts] = useState<Counts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent[]>([]);

  const loadCounts = () =>
    callFunction<Counts>("admin-clients", { action: "groupes" }).then(setCounts).catch((e: Error) => setError(e.message));
  const loadSent = () =>
    supabase.from("audit_log").select("id, target_id, created_at, details").eq("action", "message.send").order("id", { ascending: false }).limit(10)
      .then(({ data }) => setSent((data as Sent[]) ?? []));

  useEffect(() => {
    if (!isAdmin) return;
    void loadCounts();
    void loadSent();
  }, [isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isAdmin) return <Notice>Les relances sont réservées aux administrateurs.</Notice>;

  const info = SEGMENTS[segment];
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Relances</h1>
        <p className="mt-1 text-stone-500">Choisis un groupe de clients, ajuste le message, envoie. Les clients suspendus et l'équipe ne reçoivent jamais de relance.</p>
      </div>
      {error && <Notice tone="error">{error}</Notice>}

      <div className="grid gap-6 lg:grid-cols-[1fr_26rem]">
        <div className="grid content-start gap-3 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
          {ORDER.map((s) => {
            const c = counts?.counts[s];
            const active = s === segment;
            return (
              <button
                key={s}
                onClick={() => setSegment(s)}
                aria-pressed={active}
                className={`flex gap-3 rounded-2xl p-4 text-left ring-1 transition active:scale-[0.98] ${active ? "bg-brand-600 text-white shadow-lg shadow-brand-600/25 ring-brand-600" : "bg-white ring-stone-200 hover:ring-brand-300"}`}
              >
                <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${active ? "bg-white/20" : "bg-brand-50 text-brand-700"}`}>
                  <Icon name={ICONS[s]} className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-bold">{SEGMENTS[s].label}</span>
                    <span className="tabular text-xl font-extrabold">{c ? c.recipients : "…"}</span>
                  </span>
                  <span className={`block text-sm ${active ? "text-white/85" : "text-stone-500"}`}>{SEGMENTS[s].hint}</span>
                  {c && <span className={`mt-1 block text-xs ${active ? "text-white/80" : "text-stone-400"}`}>{c.withPush} avec notifications activées</span>}
                </span>
              </button>
            );
          })}
        </div>

        <Card className="space-y-3 p-5">
          <div>
            <p className="text-sm font-bold tracking-wide text-brand-700 uppercase">{info.label}</p>
            <p className="text-sm text-stone-500">{info.hint}</p>
          </div>
          <MessageComposer
            target={{ segment }}
            defaults={{ title: info.title, body: info.body, link: info.link }}
            confirmLabel={(n) => `Envoyer ce message à ${n} client${n > 1 ? "s" : ""} du groupe « ${info.label} » ?`}
            onSent={() => { void loadSent(); void loadCounts(); }}
          />
        </Card>
      </div>

      <section>
        <h2 className="mb-3 text-lg font-bold">Derniers envois</h2>
        {sent.length === 0 ? (
          <p className="text-sm text-stone-500">Aucune relance envoyée pour l'instant.</p>
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-left text-sm">
              <thead className="bg-stone-50 text-stone-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 font-medium">Destinataires</th>
                  <th className="px-4 font-medium">Titre</th>
                  <th className="px-4 font-medium">Push remises</th>
                  <th className="px-4 font-medium">Emails</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {sent.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-3 whitespace-nowrap">{fmtDateTime(s.created_at)}</td>
                    <td className="px-4">{s.target_id in SEGMENTS ? SEGMENTS[s.target_id as Segment].label : "1 client"} ({s.details.recipients})</td>
                    <td className="px-4">{s.details.title}</td>
                    <td className="tabular px-4">{s.details.push?.sent ?? 0}{s.details.push?.noDevice ? ` · ${s.details.push.noDevice} sans appareil` : ""}</td>
                    <td className="tabular px-4">{s.details.email?.sent ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>
      {counts === null && !error && <div className="flex justify-center text-brand-600"><Spinner /></div>}
    </div>
  );
}
