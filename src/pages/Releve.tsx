// Relevé du compteur : photo de l'écran lue sur le téléphone puis confirmée,
// ou saisie manuelle (BF-05), avec contrôles de cohérence (BF-06).
import { checkReading, type CheckResult } from "@shared/prevision.ts";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { AccessBanner } from "@/components/AccessBanner";
import { MeterPicker } from "@/components/MeterPicker";
import { Icon } from "@/components/icons";
import { Button, Card, Field, Input, Notice, PageTitle, useToast } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { toEngine, useData } from "@/lib/data";
import { fmtAgo, fromLocalInput, kwh, toLocalInput } from "@/lib/format";
import { readMeter } from "@/lib/lecture";
import { compressPhoto, type CompressedPhoto } from "@/lib/photo";
import { errorMessage, supabase } from "@/lib/supabase";
import { R, withQuery } from "@/lib/routes";

const TIPS = [
  "Attends que l'écran affiche le crédit restant en kWh (fais défiler l'affichage si besoin).",
  "Cadre l'écran de près, sans reflet ni flou.",
];

export default function Releve() {
  const { profile } = useAuth();
  const { meters, selectedMeter, selectMeter, history, loadHistory, afterChange, access, subscription } = useData();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const meter = selectedMeter;
  const [mode, setMode] = useState<"photo" | "confirm">("photo");
  const [value, setValue] = useState("");
  const [takenAt, setTakenAt] = useState(() => toLocalInput(new Date()));
  const [showDate, setShowDate] = useState(false);
  const [photo, setPhoto] = useState<CompressedPhoto | null>(null);
  const [ai, setAi] = useState<{ value: number | null; confidence: number | null } | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [checks, setChecks] = useState<CheckResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = params.get("compteur");
    if (id && meters.some((m) => m.id === id)) selectMeter(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (meter) void loadHistory(meter.id).catch(console.error);
  }, [meter?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const h = meter ? history(meter.id) : undefined;
  const last = h?.readings.at(-1);
  const unit = meter?.kind === "postpaid" ? "Index (kWh)" : "Crédit restant (kWh)";

  const parsed = useMemo(() => Number(value.replace(",", ".").replace(/\s/g, "")), [value]);
  const photoUrl = useMemo(() => (photo ? URL.createObjectURL(photo.blob) : null), [photo]);
  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl); }, [photoUrl]);

  if (meters.length === 0) return <Navigate to={withQuery(R.compteurs, { premier: 1 })} replace />;
  if (!meter || !profile) return null;
  if (subscription.readOnly) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageTitle>Nouveau relevé</PageTitle>
        <AccessBanner />
      </div>
    );
  }
  if (access(meter) === "lecteur") {
    return (
      <div className="mx-auto max-w-2xl">
        <PageTitle>Nouveau relevé</PageTitle>
        <MeterPicker />
        <Notice className="mt-4">« {meter.name} » t'est partagé en lecture seule : seul son propriétaire, ou un contributeur, peut y ajouter des données.</Notice>
      </div>
    );
  }

  function onRead(p: CompressedPhoto, read: { value: number | null; confidence: number | null }) {
    setPhoto(p);
    setMode("confirm");
    setTakenAt(toLocalInput(new Date()));
    setAi(read);
    if (read.value !== null) {
      setValue(String(read.value).replace(".", ","));
      setAiNote((read.confidence ?? 0) < 0.7 ? "Lecture incertaine : vérifie bien chaque chiffre." : null);
    } else {
      setValue("");
      setAiNote("Je n'ai pas réussi à lire l'écran. Saisis la valeur affichée.");
    }
  }

  async function submit(e: FormEvent, force = false) {
    e.preventDefault();
    if (!meter || !profile) return;
    setError(null);
    if (!value.trim() || !Number.isFinite(parsed)) {
      setError("Saisis la valeur affichée par le compteur.");
      return;
    }
    const at = fromLocalInput(takenAt);
    const { readings, recharges } = toEngine(h);
    const results = checkReading(meter.kind, { takenAt: at, value: parsed }, readings, recharges, new Date());
    setChecks(results);
    if (results.some((c) => c.level === "error")) return;
    if (results.length && !force) return;

    setBusy(true);
    try {
      let photoPath: string | null = null;
      if (photo) {
        photoPath = `${profile.id}/${meter.id}/${Date.now()}.jpg`;
        const up = await supabase.storage.from("photos").upload(photoPath, photo.blob, { contentType: "image/jpeg" });
        if (up.error) {
          console.warn("photo non enregistrée", up.error);
          photoPath = null;
        }
      }
      const { error } = await supabase.from("readings").insert({
        meter_id: meter.id,
        taken_at: at,
        value: parsed,
        source: photo ? "photo" : "manuel",
        photo_path: photoPath,
        ai_value: ai?.value ?? null,
        ai_confidence: ai?.confidence ?? null,
      });
      if (error) throw error;
      await afterChange(meter.id);
      toast("Relevé enregistré");
      navigate(R.app, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const blocking = checks.some((c) => c.level === "error");

  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle>Nouveau relevé</PageTitle>
      <MeterPicker />
      {params.get("premier") === "1" && (
        <Notice className="mb-4">
          Premier relevé de « {meter.name} ». Pendant quelques jours, envoie un relevé par jour : la première prévision arrive après 3 relevés sur 2 jours.
        </Notice>
      )}
      {last && (
        <p className="mb-4 text-sm text-stone-500">
          Dernier relevé : <span className="font-medium text-stone-700">{kwh(last.value)}</span>, {fmtAgo(last.taken_at)}.
        </p>
      )}

      {mode === "photo" ? (
        <Card className="space-y-4">
          <MeterPhoto onRead={onRead} />
          <Button variant="secondary" className="w-full" onClick={() => { setMode("confirm"); setPhoto(null); setAi(null); setAiNote(null); }}>
            Saisir à la main
          </Button>
        </Card>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
          <Card className="space-y-4">
            {photoUrl && <img src={photoUrl} alt="Photo du compteur" className="max-h-44 w-full rounded-xl object-contain" />}
            {aiNote && <Notice tone="warning">{aiNote}</Notice>}
            {ai?.value !== null && ai && !aiNote && <Notice tone="success">Valeur lue sur la photo. Vérifie-la puis confirme.</Notice>}
            <Field label={unit}>
              {(id) => (
                <Input
                  id={id}
                  inputMode="decimal"
                  autoFocus={!photo}
                  placeholder="0,0"
                  className="tabular text-center text-4xl font-bold"
                  value={value}
                  onChange={(e) => { setValue(e.target.value.replace(/[^\d.,\s]/g, "")); setChecks([]); }}
                />
              )}
            </Field>
            {showDate ? (
              <Field label="Date et heure du relevé">
                {(id) => <Input id={id} type="datetime-local" value={takenAt} max={toLocalInput(new Date())} onChange={(e) => { setTakenAt(e.target.value); setChecks([]); }} />}
              </Field>
            ) : (
              <button type="button" className="text-sm font-medium text-brand-700" onClick={() => setShowDate(true)}>
                Relevé fait plus tôt ? Changer la date
              </button>
            )}
          </Card>

          {checks.map((c) => (
            <Notice key={c.code} tone={c.level === "error" ? "error" : "warning"}>
              {c.message}
              {c.code === "balance_up" && (
                <>
                  {" "}
                  <Link to={withQuery(R.recharge, { compteur: meter.id })} className="font-semibold underline">Ajouter la recharge</Link>
                </>
              )}
            </Notice>
          ))}
          {error && <Notice tone="error">{error}</Notice>}

          {checks.length > 0 && !blocking ? (
            <Button type="button" loading={busy} className="w-full" onClick={(e) => void submit(e as unknown as FormEvent, true)}>
              Enregistrer quand même
            </Button>
          ) : (
            <Button type="submit" loading={busy} className="w-full" disabled={blocking}>
              Confirmer le relevé
            </Button>
          )}
          <Button type="button" variant="ghost" className="w-full" onClick={() => { setMode("photo"); setChecks([]); setError(null); }}>
            Reprendre une photo
          </Button>
        </form>
      )}
    </div>
  );
}

/** Photo de l'écran : lecture sur le téléphone, photo compressée gardée pour l'historique. */
function MeterPhoto({ onRead }: { onRead: (p: CompressedPhoto, read: { value: number | null; confidence: number | null }) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handle(file: File | undefined) {
    if (!file) return;
    setError(null);
    setProgress(0);
    try {
      // La lecture se fait sur l'image en pleine résolution, le stockage sur la version compressée.
      const [read, photo] = await Promise.all([readMeter(file, setProgress).catch(() => ({ value: null, confidence: null })), compressPhoto(file)]);
      onRead(photo, read);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Photo inutilisable");
    } finally {
      setProgress(null);
      if (input.current) input.current.value = "";
    }
  }

  if (progress !== null) {
    return (
      <div className="space-y-3 rounded-2xl bg-white p-6 text-center" role="status">
        <p className="font-semibold text-brand-700">Lecture de l'écran…</p>
        <div className="h-2.5 overflow-hidden rounded-full bg-brand-100">
          <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${Math.max(8, progress * 100)}%` }} />
        </div>
        <p className="text-xs text-stone-500">La lecture se fait sur ton téléphone : la photo n'est envoyée nulle part pour être lue.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void handle(e.target.files?.[0])} />
      <Button className="w-full" onClick={() => input.current?.click()}>
        <Icon name="camera" className="h-5 w-5" /> Photographier l'écran
      </Button>
      <ul className="space-y-1 text-sm text-stone-500">
        {TIPS.map((t) => <li key={t}>• {t}</li>)}
      </ul>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
