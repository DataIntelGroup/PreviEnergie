// Gestion des utilisateurs (BF-30) : recherche par nom, prénom, téléphone ou
// email ; changement d'offre, de rôle, suspension (admin seulement).
import { formatPhone } from "@shared/validation.ts";
import { useEffect, useState } from "react";
import { Button, Card, Field, Input, Notice, Select, Sheet, Spinner, useToast } from "@/components/ui";
import { fmtAgo, fmtDate, fmtDateLong, toLocalInput } from "@/lib/format";
import { errorMessage, supabase } from "@/lib/supabase";
import type { Plan, Role } from "@/lib/types";
import { useAdmin } from "./AdminApp";

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
  created_at: string;
  last_seen_at: string | null;
  meters: number;
  readings: number;
  last_reading_at: string | null;
}

const ROLES: Record<Role, string> = { user: "Utilisateur", support: "Support (lecture seule)", admin: "Administrateur" };
const PAGE = 30;

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
  const [form, setForm] = useState({ plan: "", expires: "", role: "user" as Role, suspended: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setRows((data as { rows: UserRow[] }).rows);
    setTotal((data as { total: number }).total);
  };

  useEffect(() => {
    void load();
  }, [query, offset]); // eslint-disable-line react-hooks/exhaustive-deps

  function open(u: UserRow) {
    setSel(u);
    setError(null);
    setForm({
      plan: u.effective_plan,
      expires: u.plan_expires_at && u.effective_plan !== "gratuit" ? toLocalInput(new Date(u.plan_expires_at)).slice(0, 10) : toLocalInput(new Date(Date.now() + 30 * 86_400_000)).slice(0, 10),
      role: u.role,
      suspended: u.suspended,
    });
  }

  async function save() {
    if (!sel) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("admin_update_user", {
      p_user: sel.id,
      p_plan: form.plan,
      p_plan_expires_at: form.plan === "gratuit" ? null : new Date(`${form.expires}T23:59:00Z`).toISOString(),
      p_role: form.role,
      p_suspended: form.suspended,
    });
    setBusy(false);
    if (error) return setError(errorMessage(error));
    toast("Utilisateur mis à jour");
    setSel(null);
    await load();
    reload();
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
              <th className="px-4 font-medium">Dernier relevé</th>
              <th className="px-4 font-medium">Inscrit le</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {loading && rows.length === 0 ? (
              <tr><td colSpan={6} className="py-10 text-center text-brand-600"><Spinner className="mx-auto h-6 w-6" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="py-10 text-center text-stone-500">Aucun utilisateur trouvé.</td></tr>
            ) : (
              rows.map((u) => (
                <tr key={u.id} onClick={() => open(u)} className="cursor-pointer hover:bg-brand-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-stone-900">
                      {u.first_name || u.last_name ? `${u.first_name ?? ""} ${u.last_name ?? ""}` : <span className="text-stone-400">Profil incomplet</span>}
                      {u.role !== "user" && <span className="ml-2 rounded bg-brand-100 px-1.5 py-0.5 text-xs text-brand-800">{u.role}</span>}
                      {u.suspended && <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">suspendu</span>}
                    </p>
                    <p className="text-stone-500">{u.email}</p>
                  </td>
                  <td className="tabular px-4 whitespace-nowrap">{u.phone ? formatPhone(u.phone) : "–"}</td>
                  <td className="px-4">{planName(u.effective_plan)}</td>
                  <td className="tabular px-4">{u.meters}</td>
                  <td className="px-4 whitespace-nowrap">{u.last_reading_at ? fmtAgo(u.last_reading_at) : "–"}</td>
                  <td className="px-4 whitespace-nowrap">{fmtDate(u.created_at)}</td>
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

      <Sheet open={!!sel} onClose={() => setSel(null)} title={sel ? `${sel.first_name ?? ""} ${sel.last_name ?? ""}`.trim() || sel.email || "Utilisateur" : ""}>
        {sel && (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-stone-500">Email</dt><dd className="break-all">{sel.email}</dd>
              <dt className="text-stone-500">Téléphone</dt><dd>{sel.phone ? formatPhone(sel.phone) : "–"}</dd>
              <dt className="text-stone-500">Commune</dt><dd>{sel.commune ?? "–"}</dd>
              <dt className="text-stone-500">Source</dt><dd>{sel.source ?? "–"}</dd>
              <dt className="text-stone-500">Relevés</dt><dd>{sel.readings}</dd>
              <dt className="text-stone-500">Dernière visite</dt><dd>{sel.last_seen_at ? fmtAgo(sel.last_seen_at) : "–"}</dd>
              <dt className="text-stone-500">Offre</dt>
              <dd>{planName(sel.effective_plan)}{sel.effective_plan !== "gratuit" && sel.plan_expires_at ? ` jusqu'au ${fmtDateLong(sel.plan_expires_at)}` : ""}</dd>
            </dl>

            {isAdmin ? (
              <>
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
                <label className="flex items-center gap-3 text-sm font-medium">
                  <input type="checkbox" className="h-5 w-5 accent-red-600" checked={form.suspended} onChange={(e) => setForm({ ...form, suspended: e.target.checked })} />
                  Compte suspendu (plus d'alertes ni de saisie)
                </label>
                {error && <Notice tone="error">{error}</Notice>}
                <Button className="w-full" loading={busy} onClick={() => void save()}>Enregistrer</Button>
              </>
            ) : (
              <Notice>Rôle support : lecture seule.</Notice>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}
