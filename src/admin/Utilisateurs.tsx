// Gestion des utilisateurs (BF-30) : recherche par nom, prénom, téléphone ou
// email ; fiche client avec message (push, email), offre, rôle, prolongation
// d'essai, suspension et suppression (admin seulement).
import { alertLabel, CHANNEL_LABELS, type Channel } from "@shared/reglages.ts";
import { formatPhone } from "@shared/validation.ts";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { Button, Field, Input, Notice, Select, Sheet, Spinner, useToast, Card } from "@/components/ui";
import { fmtAgo, fmtDate, fmtDateLong, fmtDateTime, toLocalInput } from "@/lib/format";
import { callFunction, errorMessage, supabase } from "@/lib/supabase";
import type { Plan, Role } from "@/lib/types";
import { useAdmin } from "./AdminApp";
import { MessageComposer } from "./Messages";

interface UserRow {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  commune: string | null;
  source: string | null;
  role: Role;
  plan_code: string;
  effective_plan: string;
  plan_expires_at: string | null;
  suspended: boolean;
  trial_ends_at: string;
  access: "paid" | "trial" | "expired";
  created_at: string;
  last_seen_at: string | null;
  meters: number;
  readings: number;
  last_reading_at: string | null;
  push_devices: number;
}

interface AlertRow {
  id: number;
  type: string;
  channel: Channel;
  status: "sent" | "failed";
  message: string | null;
  sent_at: string;
}

const ROLES: Record<Role, string> = { user: "Utilisateur", support: "Support (lecture seule)", admin: "Administrateur" };
const ACCESS: Record<UserRow["access"], { label: string; cls: string }> = {
  paid: { label: "Abonné", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  trial: { label: "Essai", cls: "bg-brand-50 text-brand-800 ring-brand-200" },
  expired: { label: "Lecture seule", cls: "bg-stone-100 text-stone-600 ring-stone-200" },
};
const PAGE = 30;
type Tab = "profil" | "message" | "gerer";

const fullName = (u: UserRow) => `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim();

export default function Utilisateurs() {
  const { isAdmin, reload } = useAdmin();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [sel, setSel] = useState<UserRow | null>(null);
  const [tab, setTab] = useState<Tab>("profil");
  const [history, setHistory] = useState<AlertRow[] | null>(null);
  const [form, setForm] = useState({ plan: "", expires: "", role: "user" as Role });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");

  useEffect(() => {
    supabase.from("plans").select("*").order("sort").then(({ data }) => setPlans((data as Plan[]) ?? []));
  }, []);

  // Recherche au fil de la frappe, avec un léger délai.
  useEffect(() => {
    const t = setTimeout(() => { setQuery(q); setOffset(0); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("admin_users", { p_query: query, p_limit: PAGE, p_offset: offset });
    setLoading(false);
    if (error) return toast(errorMessage(error), "error");
    const list = (data as { rows: UserRow[] }).rows;
    setRows(list);
    setTotal((data as { total: number }).total);
    // La fiche ouverte suit les changements.
    setSel((s) => (s ? list.find((u) => u.id === s.id) ?? s : s));
  };

  useEffect(() => {
    void load();
  }, [query, offset]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadHistory = async (id: string) => {
    setHistory(null);
    const { data } = await supabase.from("alerts").select("id, type, channel, status, message, sent_at").eq("user_id", id).order("sent_at", { ascending: false }).limit(12);
    setHistory((data as AlertRow[]) ?? []);
  };

  function open(u: UserRow, start: Tab = "profil") {
    setSel(u);
    setTab(start);
    setError(null);
    setDeleting(false);
    setConfirmEmail("");
    setForm({
      plan: u.effective_plan,
      expires: u.plan_expires_at && u.effective_plan !== "gratuit" ? toLocalInput(new Date(u.plan_expires_at)).slice(0, 10) : toLocalInput(new Date(Date.now() + 30 * 86_400_000)).slice(0, 10),
      role: u.role,
    });
    void loadHistory(u.id);
  }

  async function run(key: string, fn: () => Promise<unknown>, done: string) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      toast(done);
      await load();
      reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const rpc = async (name: string, args: Record<string, unknown>) => {
    const { error } = await supabase.rpc(name, args);
    if (error) throw error;
  };

  const saveAccess = () =>
    run("acces", () => rpc("admin_update_user", {
      p_user: sel!.id,
      p_plan: form.plan,
      p_plan_expires_at: form.plan === "gratuit" ? null : new Date(`${form.expires}T23:59:00Z`).toISOString(),
      p_role: form.role,
    }), "Offre et rôle mis à jour");

  const extendTrial = (days: number) => run(`essai${days}`, () => rpc("admin_extend_trial", { p_user: sel!.id, p_days: days }), `Essai prolongé de ${days} jours`);

  const setSuspended = (v: boolean) =>
    run("suspendre", () => rpc("admin_update_user", { p_user: sel!.id, p_suspended: v }), v ? "Compte suspendu" : "Compte réactivé");

  async function remove() {
    setBusy("supprimer");
    setError(null);
    try {
      await callFunction("admin-clients", { action: "supprimer", userId: sel!.id, confirm: confirmEmail });
      toast("Compte supprimé");
      setSel(null);
      await load();
      reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const planName = (c: string) => plans.find((p) => p.code === c)?.name ?? c;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Utilisateurs</h1>
        <p className="text-sm text-stone-500">{total} résultat{total > 1 ? "s" : ""}</p>
      </div>
      <Input type="search" placeholder="Nom, prénom, téléphone ou email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher" />

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead className="bg-stone-50 text-stone-500">
            <tr>
              <th className="px-4 py-3 font-medium">Nom</th>
              <th className="px-4 font-medium">Téléphone</th>
              <th className="px-4 font-medium">Offre</th>
              <th className="px-4 font-medium">Compteurs</th>
              <th className="px-4 font-medium">Notifications</th>
              <th className="px-4 font-medium">Dernier relevé</th>
              <th className="px-4 font-medium">Inscrit le</th>
              {isAdmin && <th className="px-4 font-medium"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {loading && rows.length === 0 ? (
              <tr><td colSpan={8} className="py-10 text-center text-brand-600"><Spinner className="mx-auto h-6 w-6" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} className="py-10 text-center text-stone-500">Aucun utilisateur trouvé.</td></tr>
            ) : (
              rows.map((u) => (
                <tr key={u.id} onClick={() => open(u)} className="cursor-pointer hover:bg-brand-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-stone-900">
                      {fullName(u) || <span className="text-stone-400">Profil incomplet</span>}
                      {u.role !== "user" && <span className="ml-2 rounded bg-brand-100 px-1.5 py-0.5 text-xs text-brand-800">{u.role}</span>}
                      {u.suspended && <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">suspendu</span>}
                    </p>
                    <p className="text-stone-500">{u.email}</p>
                  </td>
                  <td className="tabular px-4 whitespace-nowrap">{u.phone ? formatPhone(u.phone) : "–"}</td>
                  <td className="px-4 whitespace-nowrap">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${ACCESS[u.access].cls}`}>{u.access === "paid" ? planName(u.effective_plan) : ACCESS[u.access].label}</span>
                  </td>
                  <td className="tabular px-4">{u.meters}</td>
                  <td className="px-4 whitespace-nowrap">
                    {u.push_devices > 0 ? <span className="inline-flex items-center gap-1 text-emerald-700"><Icon name="bell" className="h-4 w-4" /> {u.push_devices}</span> : <span className="text-stone-400">–</span>}
                  </td>
                  <td className="px-4 whitespace-nowrap">{u.last_reading_at ? fmtAgo(u.last_reading_at) : "–"}</td>
                  <td className="px-4 whitespace-nowrap">{fmtDate(u.created_at)}</td>
                  {isAdmin && (
                    <td className="px-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); open(u, "message"); }}
                        className="rounded-lg p-2 text-brand-700 transition hover:bg-brand-100 active:scale-90"
                        aria-label={`Envoyer un message à ${fullName(u) || u.email}`}
                        title="Envoyer un message"
                      >
                        <Icon name="message" className="h-4 w-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      {total > PAGE && (
        <div className="flex items-center justify-between">
          <Button variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Précédent</Button>
          <span className="text-sm text-stone-500">{offset + 1}–{Math.min(offset + PAGE, total)} sur {total}</span>
          <Button variant="secondary" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>Suivant</Button>
        </div>
      )}

      <Sheet open={!!sel} onClose={() => setSel(null)} title={sel ? fullName(sel) || sel.email || "Utilisateur" : ""}>
        {sel && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${ACCESS[sel.access].cls}`}>{ACCESS[sel.access].label}</span>
              {sel.suspended && <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 ring-1 ring-red-200">Suspendu</span>}
              <span className="rounded-full bg-stone-50 px-2.5 py-1 text-xs font-semibold text-stone-600 ring-1 ring-stone-200">
                {sel.push_devices > 0 ? `${sel.push_devices} appareil(s) abonné(s)` : "Notifications non activées"}
              </span>
            </div>

            {isAdmin && (
              <div className="grid grid-cols-3 gap-1 rounded-xl bg-stone-100 p-1" role="tablist">
                {([["profil", "Profil"], ["message", "Message"], ["gerer", "Gérer"]] as [Tab, string][]).map(([t, label]) => (
                  <button
                    key={t}
                    role="tab"
                    aria-selected={tab === t}
                    onClick={() => setTab(t)}
                    className={`rounded-lg py-2 text-sm font-semibold transition ${tab === t ? "bg-white text-brand-700 shadow-sm" : "text-stone-600 hover:text-stone-900"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            {(tab === "profil" || !isAdmin) && (
              <>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <dt className="text-stone-500">Email</dt><dd className="break-all">{sel.email}</dd>
                  <dt className="text-stone-500">Téléphone</dt><dd>{sel.phone ? formatPhone(sel.phone) : "–"}</dd>
                  <dt className="text-stone-500">Commune</dt><dd>{sel.commune ?? "–"}</dd>
                  <dt className="text-stone-500">Source</dt><dd>{sel.source ?? "–"}</dd>
                  <dt className="text-stone-500">Compteurs</dt><dd>{sel.meters}</dd>
                  <dt className="text-stone-500">Relevés</dt><dd>{sel.readings}{sel.last_reading_at ? `, dernier ${fmtAgo(sel.last_reading_at)}` : ""}</dd>
                  <dt className="text-stone-500">Dernière visite</dt><dd>{sel.last_seen_at ? fmtAgo(sel.last_seen_at) : "–"}</dd>
                  <dt className="text-stone-500">Offre</dt>
                  <dd>
                    {sel.access === "paid" && `${planName(sel.effective_plan)}${sel.plan_expires_at ? ` jusqu'au ${fmtDateLong(sel.plan_expires_at)}` : ""}`}
                    {sel.access === "trial" && `Essai jusqu'au ${fmtDateLong(sel.trial_ends_at)}`}
                    {sel.access === "expired" && "Lecture seule"}
                  </dd>
                </dl>
                <div>
                  <p className="mb-2 text-sm font-semibold text-stone-700">Derniers messages et alertes</p>
                  {history === null ? (
                    <div className="flex justify-center py-4 text-brand-600"><Spinner className="h-5 w-5" /></div>
                  ) : history.length === 0 ? (
                    <p className="text-sm text-stone-500">Aucune alerte envoyée.</p>
                  ) : (
                    <ul className="divide-y divide-stone-100 rounded-xl ring-1 ring-stone-200">
                      {history.map((a) => (
                        <li key={a.id} className="px-3 py-2 text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">{alertLabel(a.type)} · {CHANNEL_LABELS[a.channel]}</span>
                            <span className={a.status === "sent" ? "text-emerald-700" : "text-red-600"}>{a.status === "sent" ? "remise" : "échec"}</span>
                          </div>
                          <p className="text-xs text-stone-500">{fmtDateTime(a.sent_at)}{a.message ? ` · ${a.message.slice(0, 90)}` : ""}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {!isAdmin && <Notice>Rôle support : lecture seule.</Notice>}
              </>
            )}

            {isAdmin && tab === "message" && (
              <MessageComposer
                target={{ userId: sel.id }}
                firstName={sel.first_name}
                defaults={{ title: "Un mot de l'équipe PréviÉnergie", body: "Bonjour {prenom}, ", link: "/app" }}
                onSent={() => void loadHistory(sel.id)}
              />
            )}

            {isAdmin && tab === "gerer" && (
              <div className="space-y-5">
                <section className="space-y-3">
                  <h3 className="font-bold text-stone-900">Offre et rôle</h3>
                  <Field label="Offre">
                    {(id) => (
                      <Select id={id} value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}>
                        {plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
                      </Select>
                    )}
                  </Field>
                  {form.plan !== "gratuit" && (
                    <Field label="Valable jusqu'au">
                      {(id) => <Input id={id} type="date" value={form.expires} onChange={(e) => setForm({ ...form, expires: e.target.value })} />}
                    </Field>
                  )}
                  <Field label="Rôle">
                    {(id) => (
                      <Select id={id} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                        {(Object.keys(ROLES) as Role[]).map((r) => <option key={r} value={r}>{ROLES[r]}</option>)}
                      </Select>
                    )}
                  </Field>
                  <Button className="w-full" loading={busy === "acces"} onClick={() => void saveAccess()}>Enregistrer l'offre et le rôle</Button>
                </section>

                {sel.access !== "paid" && (
                  <section className="space-y-2">
                    <h3 className="font-bold text-stone-900">Prolonger l'essai gratuit</h3>
                    <p className="text-sm text-stone-500">
                      {sel.access === "trial" ? `Fin actuelle : ${fmtDateLong(sel.trial_ends_at)}.` : "Essai terminé : la prolongation repart d'aujourd'hui et rouvre l'accès."}
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      {[3, 7, 14].map((d) => (
                        <Button key={d} variant="secondary" loading={busy === `essai${d}`} onClick={() => void extendTrial(d)}>+{d} jours</Button>
                      ))}
                    </div>
                  </section>
                )}

                <section className="space-y-2">
                  <h3 className="font-bold text-stone-900">{sel.suspended ? "Compte suspendu" : "Suspendre le compte"}</h3>
                  <p className="text-sm text-stone-500">
                    {sel.suspended
                      ? "Le client ne peut plus rien saisir ni payer, et ne reçoit plus d'alertes. Ses données sont gardées."
                      : "Bloque l'accès sans rien effacer : plus de saisie, de paiement ni d'alertes. Réversible à tout moment."}
                  </p>
                  <Button
                    variant="secondary"
                    className={`w-full ${sel.suspended ? "" : "text-red-700 ring-red-200 hover:bg-red-50"}`}
                    loading={busy === "suspendre"}
                    onClick={() => void setSuspended(!sel.suspended)}
                  >
                    {sel.suspended ? "Réactiver le compte" : "Suspendre le compte"}
                  </Button>
                </section>

                <section className="space-y-2 rounded-2xl bg-red-50 p-4 ring-1 ring-red-200">
                  <h3 className="font-bold text-red-800">Supprimer définitivement</h3>
                  <p className="text-sm text-red-800/80">
                    Efface le compte, les compteurs, relevés, recharges, factures, photos et partages. Les paiements restent, anonymisés, pour la comptabilité. Irréversible.
                  </p>
                  {sel.role !== "user" ? (
                    <p className="text-sm text-red-800">Compte de l'équipe : remets-le en « Utilisateur » avant de pouvoir le supprimer.</p>
                  ) : !deleting ? (
                    <Button variant="secondary" className="w-full text-red-700 ring-red-300 hover:bg-red-100" onClick={() => setDeleting(true)}>Supprimer ce compte…</Button>
                  ) : (
                    <div className="space-y-2">
                      <Field label={`Recopie l'email du client pour confirmer : ${sel.email}`}>
                        {(id) => <Input id={id} value={confirmEmail} autoComplete="off" onChange={(e) => setConfirmEmail(e.target.value)} />}
                      </Field>
                      <div className="grid grid-cols-2 gap-2">
                        <Button variant="secondary" onClick={() => { setDeleting(false); setConfirmEmail(""); }}>Annuler</Button>
                        <Button
                          className="bg-red-600 hover:bg-red-700 active:bg-red-800 disabled:bg-red-200"
                          disabled={confirmEmail.trim().toLowerCase() !== (sel.email ?? "").toLowerCase()}
                          loading={busy === "supprimer"}
                          onClick={() => void remove()}
                        >
                          Supprimer
                        </Button>
                      </div>
                    </div>
                  )}
                </section>
                {error && <Notice tone="error">{error}</Notice>}
              </div>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}
