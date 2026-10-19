// Compte : profil (BF-03), compteurs, offre, export et suppression des données.
import { formatPhone } from "@shared/validation.ts";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ProfileForm } from "@/components/ProfileForm";
import { Button, Card, Field, Input, Notice, PageTitle, Sheet, useToast } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useData } from "@/lib/data";
import { fmtDateLong } from "@/lib/format";
import { callFunction, errorMessage, supabase } from "@/lib/supabase";
import { effectivePlanCode } from "@/lib/types";
import { R } from "@/lib/routes";

function Row({ to, label, value }: { to: string; label: string; value?: string }) {
  return (
    <Link to={to} className="flex items-center justify-between px-4 py-4 hover:bg-stone-50">
      <span className="font-medium">{label}</span>
      <span className="text-sm text-stone-500">{value} ›</span>
    </Link>
  );
}

export default function Compte() {
  const { profile, signOut } = useAuth();
  const { meters, plans } = useData();
  const toast = useToast();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!profile) return null;
  const plan = plans.find((p) => p.code === effectivePlanCode(profile));

  async function exportData() {
    setBusy(true);
    try {
      const [p, m, r, c, a, pay, fb] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", profile!.id).single(),
        supabase.from("meters").select("*"),
        supabase.from("readings").select("*").order("taken_at"),
        supabase.from("recharges").select("*").order("purchased_at"),
        supabase.from("alerts").select("*").order("sent_at"),
        supabase.from("payments").select("id, plan_code, amount_fcfa, transaction_id, status, method, period_start, period_end, created_at"),
        supabase.from("cutoff_feedback").select("*"),
      ]);
      const data = {
        exporte_le: new Date().toISOString(),
        profil: p.data, compteurs: m.data, releves: r.data, recharges: c.data, alertes: a.data, paiements: pay.data, retours_coupure: fb.data,
      };
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `previenergie-mes-donnees-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount() {
    setBusy(true);
    setError(null);
    try {
      await callFunction("supprimer-compte", { confirm: "SUPPRIMER" });
      await signOut();
      navigate(R.connexion, { replace: true });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageTitle>Mon compte</PageTitle>

      <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-brand-600 text-2xl font-extrabold text-white">
          {(profile.first_name ?? "?").slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
        <p className="text-lg font-semibold">{profile.first_name} {profile.last_name}</p>
        <p className="text-sm text-stone-500">{profile.email}</p>
        <p className="text-sm text-stone-500">{profile.phone ? formatPhone(profile.phone) : ""}{profile.commune ? ` · ${profile.commune}` : ""}</p>
        </div>
        <Button variant="secondary" className="sm:w-auto" onClick={() => setEditing(true)}>Modifier mon profil</Button>
      </Card>

      <div className="divide-y divide-stone-200 overflow-hidden rounded-2xl bg-white ring-1 ring-stone-200">
        <Row to={R.compteurs} label="Mes compteurs" value={String(meters.length)} />
        <Row to={R.offres} label="Mon offre" value={plan?.name} />
        <Row to={R.alertes} label="Mes alertes" />
        <Row to={R.confidentialite} label="Confidentialité" />
      </div>
      {profile.plan_expires_at && plan?.code !== "gratuit" && (
        <p className="text-sm text-stone-500">Offre active jusqu'au {fmtDateLong(profile.plan_expires_at)}.</p>
      )}

      <Card className="space-y-3">
        <h2 className="font-semibold">Mes données</h2>
        <Button variant="secondary" className="w-full" loading={busy && !deleting} onClick={() => void exportData()}>Télécharger mes données</Button>
        <Button variant="ghost" className="w-full text-red-600" onClick={() => setDeleting(true)}>Supprimer mon compte</Button>
      </Card>

      <Button variant="ghost" className="w-full" onClick={() => void signOut()}>Me déconnecter</Button>

      <Sheet open={editing} onClose={() => setEditing(false)} title="Mon profil">
        <ProfileForm profile={profile} submitLabel="Enregistrer" onSaved={() => { setEditing(false); toast("Profil enregistré"); }} />
      </Sheet>
      <Sheet open={deleting} onClose={() => setDeleting(false)} title="Supprimer mon compte">
        <div className="space-y-4">
          <Notice tone="warning">Ton profil, tes compteurs, relevés, recharges, photos et alertes seront effacés définitivement. Une offre en cours n'est pas remboursée.</Notice>
          <Field label="Écris SUPPRIMER pour confirmer">
            {(id) => <Input id={id} value={confirm} onChange={(e) => setConfirm(e.target.value.toUpperCase())} autoCapitalize="characters" />}
          </Field>
          {error && <Notice tone="error">{error}</Notice>}
          <Button variant="danger" className="w-full" disabled={confirm !== "SUPPRIMER"} loading={busy} onClick={() => void deleteAccount()}>
            Supprimer définitivement
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
