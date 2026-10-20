// Partage d'un compteur avec un proche (BF-15) : invitations reçues, et
// gestion des personnes invitées par le propriétaire.
import { type FormEvent, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useData } from "@/lib/data";
import { R } from "@/lib/routes";
import { errorMessage, supabase } from "@/lib/supabase";
import type { Meter, ShareRow } from "@/lib/types";
import { Icon } from "./icons";
import { Button, Card, Field, Input, Notice, Select, Toggle, useToast } from "./ui";

const ROLE_LABEL = { lecteur: "Voit tout", contributeur: "Voit et ajoute des relevés" } as const;

/** Bandeau des invitations reçues, affiché sur l'accueil et sur les compteurs. */
export function Invitations() {
  const { invitations, refreshMeters, selectMeter } = useData();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  if (invitations.length === 0) return null;

  async function answer(s: ShareRow, accept: boolean) {
    setBusy(s.id);
    const { error } = await supabase.rpc(accept ? "accept_share" : "remove_share", { p_share: s.id });
    setBusy(null);
    if (error) return toast(errorMessage(error), "error");
    await refreshMeters();
    if (accept) selectMeter(s.meter_id);
    toast(accept ? "Compteur ajouté à ton tableau de bord" : "Invitation refusée");
  }

  return (
    <div className="space-y-3">
      {invitations.map((s) => (
        <div key={s.id} className="flex flex-col gap-3 rounded-2xl bg-stone-900 p-4 text-white sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-500"><Icon name="users" className="h-5 w-5" /></span>
            <p className="text-sm">
              <strong>{s.owner_name || "Un proche"}</strong> te partage un compteur ({ROLE_LABEL[s.role].toLowerCase()}).
            </p>
          </div>
          <div className="flex gap-2">
            <button disabled={busy === s.id} onClick={() => void answer(s, false)} className="rounded-xl px-4 py-2 text-sm font-semibold text-stone-300 hover:bg-white/10">Refuser</button>
            <button disabled={busy === s.id} onClick={() => void answer(s, true)} className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-stone-900">Accepter</button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Contenu de la fenêtre « Partager » d'un compteur dont je suis propriétaire. */
export function ShareManager({ meter }: { meter: Meter }) {
  const { shares, refreshShares } = useData();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"lecteur" | "contributeur">("lecteur");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = shares.filter((s) => s.meter_id === meter.id);
  const appUrl = `${window.location.origin}${R.connexion}`;
  const message = `Je te partage le suivi de mon compteur « ${meter.name} » sur PréviÉnergie. Crée ton compte avec ton email ici : ${appUrl}`;

  async function invite(e: FormEvent) {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) return setError("Entre une adresse email valide.");
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("share_meter", { p_meter: meter.id, p_email: email.trim(), p_role: role, p_alerts: true });
    setBusy(false);
    if (error) return setError(errorMessage(error));
    setEmail("");
    await refreshShares();
    toast("Invitation créée");
  }

  async function changeRole(s: ShareRow, r: "lecteur" | "contributeur") {
    const { error } = await supabase.rpc("update_share", { p_share: s.id, p_role: r });
    if (error) return toast(errorMessage(error), "error");
    await refreshShares();
  }

  async function remove(s: ShareRow) {
    const { error } = await supabase.rpc("remove_share", { p_share: s.id });
    if (error) return toast(errorMessage(error), "error");
    await refreshShares();
    toast("Partage retiré");
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-stone-600">
        Un proche (famille à l'étranger, colocataire) suit ce compteur depuis son propre compte et reçoit les alertes. Il doit se connecter avec l'email que tu indiques.
      </p>
      <form onSubmit={invite} className="space-y-3" noValidate>
        <Field label="Email de la personne">
          {(id) => <Input id={id} type="email" inputMode="email" placeholder="proche@exemple.com" value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Field label="Ce qu'elle peut faire">
          {(id) => (
            <Select id={id} value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
              <option value="lecteur">Voir la prévision et l'historique</option>
              <option value="contributeur">Voir et ajouter des relevés et recharges</option>
            </Select>
          )}
        </Field>
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" loading={busy} className="w-full">Inviter</Button>
      </form>

      {list.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-stone-700">Personnes invitées ({list.length}/5)</h3>
          <ul className="divide-y divide-stone-100 rounded-xl ring-1 ring-stone-200">
            {list.map((s) => (
              <li key={s.id} className="space-y-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-medium">{s.email}</p>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${s.status === "accepted" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
                    {s.status === "accepted" ? "Acceptée" : "En attente"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    aria-label={`Rôle de ${s.email}`}
                    value={s.role}
                    onChange={(e) => void changeRole(s, e.target.value as typeof role)}
                    className="min-w-0 flex-1 rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
                  >
                    <option value="lecteur">{ROLE_LABEL.lecteur}</option>
                    <option value="contributeur">{ROLE_LABEL.contributeur}</option>
                  </select>
                  <button onClick={() => void remove(s)} className="rounded-lg px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50">Retirer</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <a
        href={`https://wa.me/?text=${encodeURIComponent(message)}`}
        target="_blank"
        rel="noreferrer"
        className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white hover:bg-emerald-700"
      >
        <Icon name="message" className="h-4 w-4" /> Prévenir par WhatsApp
      </a>
    </div>
  );
}

/** Compteurs que d'autres m'ont partagés : rôle, alertes, quitter. */
export function SharedWithMe() {
  const { profile } = useAuth();
  const { meters, shares, refreshMeters, refreshShares } = useData();
  const toast = useToast();
  const visible = shares.filter((s) => s.status === "accepted" && s.member_id === profile?.id && meters.some((m) => m.id === s.meter_id));
  if (visible.length === 0) return null;

  async function toggleAlerts(s: ShareRow, v: boolean) {
    const { error } = await supabase.rpc("update_share", { p_share: s.id, p_alerts: v });
    if (error) return toast(errorMessage(error), "error");
    await refreshShares();
  }

  async function leave(s: ShareRow) {
    const { error } = await supabase.rpc("remove_share", { p_share: s.id });
    if (error) return toast(errorMessage(error), "error");
    await refreshMeters();
    toast("Tu ne suis plus ce compteur");
  }

  return (
    <div>
      <h2 className="mb-3 text-lg font-bold">Partagés avec moi</h2>
      <ul className="grid gap-3 sm:grid-cols-2">
        {visible.map((s) => {
          const m = meters.find((x) => x.id === s.meter_id)!;
          return (
            <li key={s.id}>
              <Card className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{m.name}</p>
                    <p className="text-sm text-stone-500">De {s.owner_name || "un proche"} · {ROLE_LABEL[s.role]}</p>
                  </div>
                  <button onClick={() => void leave(s)} className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50">Quitter</button>
                </div>
                <Toggle label="Recevoir ses alertes" checked={s.alerts} onChange={(v) => void toggleAlerts(s, v)} />
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
