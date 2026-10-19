// Compteurs de l'utilisateur, en nombre limité par l'offre (BF-04).
import { type FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button, Card, Field, Input, Notice, PageTitle, Select, Sheet, useToast } from "@/components/ui";
import { useData } from "@/lib/data";
import { errorMessage, supabase } from "@/lib/supabase";
import type { Meter } from "@/lib/types";
import { R, withQuery } from "@/lib/routes";

const KIND_LABEL = { prepaid: "Prépayé", postpaid: "Postpayé" } as const;

function MeterForm({ meter, onDone }: { meter?: Meter; onDone: (m: Meter) => void }) {
  const [name, setName] = useState(meter?.name ?? "");
  const [kind, setKind] = useState<Meter["kind"]>(meter?.kind ?? "prepaid");
  const [number, setNumber] = useState(meter?.number ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Donne un nom à ce compteur, par exemple Maison ou Boutique.");
      return;
    }
    setBusy(true);
    setError(null);
    const row = { name: name.trim(), kind, number: number.trim() || null };
    const q = meter
      ? supabase.from("meters").update(row).eq("id", meter.id).select().single()
      : supabase.from("meters").insert(row).select().single();
    const { data, error } = await q;
    setBusy(false);
    if (error) {
      setError(errorMessage(error));
      return;
    }
    onDone(data as Meter);
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field label="Nom du compteur">
        {(id) => <Input id={id} placeholder="Maison, Boutique…" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />}
      </Field>
      <Field label="Type de compteur" hint={kind === "prepaid" ? "Tu achètes du crédit (kWh) avant de consommer." : "Tu reçois une facture après consommation."}>
        {(id) => (
          <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as Meter["kind"])}>
            <option value="prepaid">Prépayé (recharge)</option>
            <option value="postpaid">Postpayé (facture)</option>
          </Select>
        )}
      </Field>
      <Field label="Numéro du compteur (facultatif)" hint="Inscrit sur le compteur ou sur tes reçus.">
        {(id) => <Input id={id} inputMode="numeric" value={number} maxLength={40} onChange={(e) => setNumber(e.target.value)} />}
      </Field>
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" loading={busy} className="w-full">
        {meter ? "Enregistrer" : "Ajouter le compteur"}
      </Button>
    </form>
  );
}

export default function Compteurs() {
  const { meters, currentPlan, refreshMeters, selectMeter } = useData();
  const [params] = useSearchParams();
  const first = params.get("premier") === "1";
  const navigate = useNavigate();
  const toast = useToast();
  const [adding, setAdding] = useState(first && meters.length === 0);
  const [editing, setEditing] = useState<Meter | null>(null);
  const [deleting, setDeleting] = useState<Meter | null>(null);
  const [busy, setBusy] = useState(false);
  const limit = currentPlan?.max_meters ?? 1;
  const full = meters.length >= limit;

  async function remove(m: Meter) {
    setBusy(true);
    const { error } = await supabase.from("meters").delete().eq("id", m.id);
    setBusy(false);
    setDeleting(null);
    if (error) return toast(errorMessage(error), "error");
    await refreshMeters();
    toast("Compteur supprimé");
  }

  return (
    <div>
      <PageTitle action={!full && <Button variant="secondary" onClick={() => setAdding(true)}>Ajouter</Button>}>Mes compteurs</PageTitle>

      {meters.length === 0 && !adding && (
        <Card className="text-center">
          <p className="text-stone-700">Ajoute ton premier compteur pour commencer.</p>
          <Button className="mt-4 w-full" onClick={() => setAdding(true)}>Ajouter un compteur</Button>
        </Card>
      )}

      <ul className="grid gap-3 sm:grid-cols-2">
        {meters.map((m) => (
          <li key={m.id}>
            <Card className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-semibold text-stone-900">{m.name}</p>
                <p className="text-sm text-stone-500">
                  {KIND_LABEL[m.kind]}
                  {m.number ? ` · n° ${m.number}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button className="rounded-lg px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50" onClick={() => setEditing(m)}>Modifier</button>
                <button className="rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50" onClick={() => setDeleting(m)}>Supprimer</button>
              </div>
            </Card>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-sm text-stone-500">
        Offre {currentPlan?.name ?? "Gratuit"} : {meters.length} / {limit} compteur{limit > 1 ? "s" : ""}.
        {full && (
          <>
            {" "}
            <Link to={R.offres} className="font-medium text-brand-700">Passer à une offre supérieure</Link> pour en ajouter.
          </>
        )}
      </p>

      <Sheet open={adding} onClose={() => setAdding(false)} title="Nouveau compteur">
        <MeterForm
          onDone={async (m) => {
            setAdding(false);
            await refreshMeters();
            selectMeter(m.id);
            toast("Compteur ajouté");
            if (first) navigate(withQuery(R.releve, { compteur: m.id, premier: 1 }));
          }}
        />
      </Sheet>
      <Sheet open={!!editing} onClose={() => setEditing(null)} title="Modifier le compteur">
        {editing && (
          <MeterForm
            meter={editing}
            onDone={async () => {
              setEditing(null);
              await refreshMeters();
              toast("Compteur modifié");
            }}
          />
        )}
      </Sheet>
      <Sheet open={!!deleting} onClose={() => setDeleting(null)} title="Supprimer ce compteur ?">
        {deleting && (
          <div className="space-y-4">
            <p className="text-stone-700">
              « {deleting.name} » et tous ses relevés, recharges et alertes seront effacés. C'est définitif.
            </p>
            <Button variant="danger" className="w-full" loading={busy} onClick={() => void remove(deleting)}>Supprimer définitivement</Button>
            <Button variant="ghost" className="w-full" onClick={() => setDeleting(null)}>Annuler</Button>
          </div>
        )}
      </Sheet>
    </div>
  );
}
