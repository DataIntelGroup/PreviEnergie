// Demandes à traiter par l'équipe : paiements manuels à vérifier (le client
// a envoyé l'argent sur un de nos numéros et déclaré la transaction) et
// mots de passe oubliés (code à envoyer par WhatsApp au numéro du compte).
// Réservé aux administrateurs (fonction admin-demandes).
import { type ManualMethod, formatPhone, PAYMENT_LABELS, type PaymentMethod } from "@shared/validation.ts";
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Notice, Spinner, useToast } from "@/components/ui";
import { useData } from "@/lib/data";
import { fcfa, fmtAgo, fmtDateTime } from "@/lib/format";
import { callFunction, errorMessage } from "@/lib/supabase";
import { useAdmin } from "./AdminApp";

interface Person { id: string; first_name: string | null; last_name: string | null; phone: string | null; email: string | null }
interface Pending {
  id: string; user_id: string | null; plan_code: string; amount_fcfa: number; declared_amount: number | null;
  method: ManualMethod; reference: string; payer_phone: string | null; created_at: string;
}
interface Done {
  id: string; user_id: string | null; plan_code: string; amount_fcfa: number; declared_amount: number | null;
  method: ManualMethod; reference: string; status: "accepted" | "refused"; refusal_reason: string | null; verified_at: string;
}
interface Reset { id: string; user_id: string; status: "requested" | "code_sent"; code_expires_at: string | null; attempts: number; created_at: string; handled_at: string | null }
export interface Demandes { pending: Pending[]; recent: Done[]; resets: Reset[]; people: Person[] }

const REASONS = [
  "Transaction introuvable sur notre compte",
  "Montant reçu inférieur au prix de l'offre",
  "Identifiant de transaction incorrect",
];

const name = (p: Person | undefined) => (p ? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || p.email || (p.phone ? formatPhone(p.phone) : "Client") : "Compte supprimé");

export default function ATraiter() {
  const { isAdmin } = useAdmin();
  const { plans, settings } = useData();
  const toast = useToast();
  const [data, setData] = useState<Demandes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refusing, setRefusing] = useState<string | null>(null);
  const [reason, setReason] = useState(REASONS[0]);
  const [codes, setCodes] = useState<Record<string, { code: string; expiresAt: string }>>({});

  const load = useCallback(async () => {
    try {
      setData(await callFunction<Demandes>("admin-demandes", { action: "liste" }));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [isAdmin, load]);

  if (!isAdmin) return <Notice>Réservé aux administrateurs.</Notice>;
  if (!data) return error ? <Notice tone="error">{error}</Notice> : <div className="flex justify-center py-20 text-brand-600"><Spinner /></div>;

  const person = (id: string | null) => data.people.find((p) => p.id === id);
  const planName = (code: string) => plans.find((p) => p.code === code)?.name ?? code;

  async function act(key: string, body: Record<string, unknown>, ok: string) {
    setBusy(key);
    try {
      const r = await callFunction<{ code?: string; expiresAt?: string }>("admin-demandes", body);
      if (r.code && r.expiresAt && typeof body.resetId === "string") setCodes((c) => ({ ...c, [body.resetId as string]: { code: r.code!, expiresAt: r.expiresAt! } }));
      toast(ok);
      setRefusing(null);
      await load();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  }

  const late = (iso: string) => Date.now() - new Date(iso).getTime() > settings.manualPayment.delayMinutes * 60_000;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">À traiter</h1>
        <p className="text-sm text-stone-500">Mis à jour toutes les 30 secondes. Délai promis aux clients : {settings.manualPayment.delayMinutes} minutes.</p>
      </div>
      {error && <Notice tone="error">{error}</Notice>}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Paiements à vérifier ({data.pending.length})</h2>
        {data.pending.length === 0 && <p className="text-sm text-stone-500">Aucun paiement en attente.</p>}
        {data.pending.map((p) => {
          const who = person(p.user_id);
          const short = (p.declared_amount ?? 0) < p.amount_fcfa;
          return (
            <Card key={p.id} className={`space-y-3 ${late(p.created_at) ? "ring-2 ring-red-300" : ""}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{name(who)}</p>
                  <p className="text-sm text-stone-500">{who?.phone ? formatPhone(who.phone) : ""}{who?.email ? ` · ${who.email}` : ""}</p>
                </div>
                <p className={`text-sm ${late(p.created_at) ? "font-semibold text-red-700" : "text-stone-500"}`}>déclaré {fmtAgo(p.created_at)}</p>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                <div><dt className="text-stone-500">Offre</dt><dd className="font-medium">{planName(p.plan_code)} · {fcfa(p.amount_fcfa)}</dd></div>
                <div><dt className="text-stone-500">Montant déclaré</dt><dd className={`font-medium ${short ? "text-red-700" : ""}`}>{fcfa(p.declared_amount)}</dd></div>
                <div><dt className="text-stone-500">Moyen</dt><dd className="font-medium">{PAYMENT_LABELS[p.method as PaymentMethod] ?? p.method}</dd></div>
                <div><dt className="text-stone-500">Payé depuis</dt><dd className="font-medium">{p.payer_phone ? formatPhone(p.payer_phone) : "–"}</dd></div>
              </dl>
              <div className="rounded-xl bg-stone-50 px-3 py-2 ring-1 ring-stone-200">
                <p className="text-xs text-stone-500">Identifiant de transaction à retrouver sur le compte {PAYMENT_LABELS[p.method as PaymentMethod] ?? ""}</p>
                <p className="tabular font-mono text-lg font-bold break-all select-all">{p.reference}</p>
              </div>
              {refusing === p.id ? (
                <div className="space-y-2">
                  <select value={reason} onChange={(e) => setReason(e.target.value)} className="block min-h-12 w-full rounded-xl border border-stone-300 bg-white px-4">
                    {REASONS.map((r) => <option key={r}>{r}</option>)}
                  </select>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="secondary" onClick={() => setRefusing(null)}>Annuler</Button>
                    <Button className="bg-red-600 hover:bg-red-700 active:bg-red-800" loading={busy === `r-${p.id}`}
                      onClick={() => void act(`r-${p.id}`, { action: "refuser", paymentId: p.id, reason }, "Paiement refusé, client prévenu")}>
                      Refuser
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" disabled={!!busy} onClick={() => { setReason(short ? REASONS[1] : REASONS[0]); setRefusing(p.id); }}>Refuser…</Button>
                  <Button loading={busy === `v-${p.id}`} disabled={!!busy}
                    onClick={() => void act(`v-${p.id}`, { action: "valider", paymentId: p.id }, "Offre activée, client prévenu")}>
                    Reçu : activer
                  </Button>
                </div>
              )}
            </Card>
          );
        })}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Mots de passe oubliés ({data.resets.length})</h2>
        {data.resets.length === 0 && <p className="text-sm text-stone-500">Aucune demande.</p>}
        {data.resets.map((r) => {
          const who = person(r.user_id);
          const fresh = codes[r.id];
          const text = fresh ? `PréviÉnergie : ton code pour changer ton mot de passe est ${fresh.code}. Valable 24 h. Sur la page de connexion : Mot de passe oublié, puis J'ai déjà un code. Ne le partage avec personne.` : "";
          return (
            <Card key={r.id} className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{name(who)}</p>
                  <p className="text-sm text-stone-500">{who?.phone ? formatPhone(who.phone) : "Pas de numéro"}{who?.email ? ` · ${who.email}` : ""}</p>
                </div>
                <p className="text-sm text-stone-500">
                  demandé {fmtAgo(r.created_at)}
                  {r.status === "code_sent" && r.handled_at && ` · code envoyé ${fmtAgo(r.handled_at)}`}
                </p>
              </div>
              {fresh ? (
                <div className="space-y-2 rounded-xl bg-emerald-50 p-3 ring-1 ring-emerald-200">
                  <p className="text-sm text-emerald-900">Code valable jusqu'au {fmtDateTime(fresh.expiresAt)}, affiché une seule fois :</p>
                  <p className="tabular text-3xl font-extrabold tracking-[0.3em] text-emerald-900 select-all">{fresh.code}</p>
                  {who?.phone ? (
                    <a href={`https://wa.me/225${who.phone}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer"
                      className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-emerald-600 px-5 font-semibold text-white hover:bg-emerald-700">
                      Envoyer par WhatsApp au {formatPhone(who.phone)}
                    </a>
                  ) : who?.email ? (
                    <a href={`mailto:${who.email}?subject=${encodeURIComponent("Ton code PréviÉnergie")}&body=${encodeURIComponent(text)}`}
                      className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-emerald-600 px-5 font-semibold text-white hover:bg-emerald-700">
                      Envoyer par email à {who.email}
                    </a>
                  ) : null}
                  <p className="text-xs text-emerald-900/80">Envoie-le uniquement au numéro (ou à l'email) du compte, jamais à un autre contact, même sur demande.</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" disabled={!!busy} loading={busy === `c-${r.id}`}
                    onClick={() => void act(`c-${r.id}`, { action: "clore", resetId: r.id }, "Demande classée")}>
                    Classer
                  </Button>
                  <Button disabled={!!busy || (!who?.phone && !who?.email)} loading={busy === `g-${r.id}`}
                    onClick={() => void act(`g-${r.id}`, { action: "code", resetId: r.id }, "Code généré")}>
                    {r.status === "code_sent" ? "Nouveau code" : "Générer un code"}
                  </Button>
                </div>
              )}
            </Card>
          );
        })}
      </section>

      {data.recent.length > 0 && (
        <section>
          <h2 className="mb-2 text-lg font-semibold">Traités ces 7 derniers jours</h2>
          <ul className="divide-y divide-stone-200 overflow-hidden rounded-2xl bg-white text-sm ring-1 ring-stone-200">
            {data.recent.map((p) => (
              <li key={p.id} className="flex flex-wrap justify-between gap-2 px-4 py-3">
                <span>{name(person(p.user_id))} · {planName(p.plan_code)} · {PAYMENT_LABELS[p.method as PaymentMethod] ?? p.method} · réf. {p.reference}</span>
                <span className={p.status === "accepted" ? "text-emerald-700" : "text-red-600"}>
                  {fcfa(p.declared_amount ?? p.amount_fcfa)} · {p.status === "accepted" ? "validé" : `refusé (${p.refusal_reason ?? ""})`} · {fmtAgo(p.verified_at)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
