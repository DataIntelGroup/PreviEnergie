// Lecture d'un reçu de recharge ou d'une facture postpayée, entièrement sur
// le téléphone : photo, capture d'écran ou PDF importé, ou SMS collé.
import { type BillRead, parseBillText, parseReceiptText, type ReceiptRead } from "@shared/lecture-recu.ts";
import { useRef, useState } from "react";
import { isPdf, type ReadMethod, readFile } from "@/lib/lecture";
import { compressPhoto, type CompressedPhoto } from "@/lib/photo";
import { Icon } from "./icons";
import { Button, Notice } from "./ui";

export interface DocumentResult {
  method: ReadMethod;
  receipt: ReceiptRead | null;
  bill: BillRead | null;
  /** Image compressée pour le stockage (pas pour un PDF ni un SMS). */
  photo: CompressedPhoto | null;
}

export function LectureDocument({
  kind,
  onResult,
  onManual,
}: {
  kind: "recu" | "facture";
  onResult: (r: DocumentResult) => void;
  onManual: () => void;
}) {
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sms, setSms] = useState<string | null>(null);

  const parse = (text: string) => (kind === "recu" ? { receipt: parseReceiptText(text), bill: null } : { receipt: null, bill: parseBillText(text) });

  async function handle(file: File | undefined) {
    if (!file) return;
    setError(null);
    setProgress(0);
    try {
      const pdf = isPdf(file);
      setBusy(pdf ? "Lecture du PDF…" : "Préparation du lecteur…");
      const read = await readFile(file, (p) => {
        setBusy("Lecture sur ton téléphone…");
        setProgress(p);
      });
      // L'image stockée est compressée ; la lecture, elle, s'est faite en pleine résolution.
      const photo = pdf ? null : await compressPhoto(file).catch(() => null);
      onResult({ method: read.method, photo, ...parse(read.text) });
    } catch (e) {
      console.error(e);
      setError("La lecture n'a pas marché sur ce document. Réessaie avec une photo plus nette, ou saisis à la main.");
    } finally {
      setBusy(null);
      for (const r of [camera, picker]) if (r.current) r.current.value = "";
    }
  }

  if (busy) {
    return (
      <div className="space-y-3 rounded-2xl bg-white p-6 text-center ring-1 ring-stone-200" role="status">
        <p className="font-semibold text-brand-700">{busy}</p>
        <div className="h-2.5 overflow-hidden rounded-full bg-brand-100">
          <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${Math.max(8, progress * 100)}%` }} />
        </div>
        <p className="text-xs text-stone-500">La lecture se fait sur ton téléphone : ta photo n'est envoyée nulle part pour être lue.</p>
      </div>
    );
  }

  if (sms !== null) {
    return (
      <div className="space-y-3">
        <label htmlFor="sms" className="block text-sm font-medium text-stone-700">Colle ici le SMS de recharge</label>
        <textarea
          id="sms"
          rows={6}
          value={sms}
          onChange={(e) => setSms(e.target.value)}
          placeholder="Ex. : Achat CIE prépayé. Montant : 5000 FCFA. Énergie : 45,2 kWh. Code : 1234-5678-…"
          className="block w-full rounded-xl border border-stone-300 px-4 py-3 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-200 focus:outline-none"
        />
        <Button className="w-full" disabled={sms.trim().length < 10} onClick={() => onResult({ method: "texte", photo: null, ...parse(sms) })}>
          Lire le SMS
        </Button>
        <Button variant="ghost" className="w-full" onClick={() => setSms(null)}>Retour</Button>
      </div>
    );
  }

  const tiles: { icon: "camera" | "download" | "message"; title: string; sub: string; onClick: () => void }[] = [
    { icon: "camera", title: "Photographier", sub: kind === "recu" ? "le reçu papier" : "la facture, à plat", onClick: () => camera.current?.click() },
    { icon: "download", title: "Importer", sub: "une capture d'écran ou un PDF", onClick: () => picker.current?.click() },
  ];
  if (kind === "recu") tiles.push({ icon: "message", title: "Coller un SMS", sub: "de Wave, Orange, MTN ou Moov", onClick: () => setSms("") });

  return (
    <div className="space-y-4">
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void handle(e.target.files?.[0])} />
      <input ref={picker} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => void handle(e.target.files?.[0])} />
      <div className={`grid gap-3 ${tiles.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        {tiles.map((t) => (
          <button
            key={t.title}
            onClick={t.onClick}
            className="flex items-center gap-3 rounded-2xl bg-white p-4 text-left ring-1 ring-stone-200 transition hover:ring-brand-300 active:scale-[0.98] sm:flex-col sm:items-start"
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-600 text-white"><Icon name={t.icon} className="h-5 w-5" /></span>
            <span>
              <span className="block font-bold text-stone-900">{t.title}</span>
              <span className="block text-sm text-stone-500">{t.sub}</span>
            </span>
          </button>
        ))}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <p className="text-sm text-stone-500">
        {kind === "recu"
          ? "Astuce : sur Wave, ouvre la transaction puis « Partager le reçu » et enregistre l'image ; sur Orange Money, télécharge le reçu en PDF."
          : "Astuce : photographie la facture entière, bien à plat et éclairée, sans reflet."}
      </p>
      <Button variant="secondary" className="w-full" onClick={onManual}>Saisir à la main</Button>
    </div>
  );
}
