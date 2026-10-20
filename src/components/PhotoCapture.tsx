// Prise de photo (appareil arrière), compression et lecture par l'IA.
import { useRef, useState } from "react";
import { compressPhoto, type CompressedPhoto } from "@/lib/photo";
import { callFunction } from "@/lib/supabase";
import { Button, Notice, Spinner } from "./ui";

export interface ReadResponse<T> {
  ok: boolean;
  result?: T;
  confidence?: number | null;
  message?: string;
}

export function PhotoCapture<T>({
  kind,
  meterKind,
  label,
  onRead,
  tips,
}: {
  kind: "compteur" | "recu" | "facture";
  meterKind: "prepaid" | "postpaid";
  label: string;
  tips: string[];
  onRead: (photo: CompressedPhoto, read: ReadResponse<T>) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"compress" | "read" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  async function handle(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy("compress");
    try {
      const photo = await compressPhoto(file);
      setPreview(URL.createObjectURL(photo.blob));
      setBusy("read");
      let read: ReadResponse<T>;
      try {
        read = await callFunction<ReadResponse<T>>("lire-photo", { kind, image: photo.base64, mediaType: "image/jpeg", meterKind });
      } catch (e) {
        read = { ok: false, message: e instanceof Error ? e.message : "Lecture automatique indisponible." };
      }
      onRead(photo, read);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Photo inutilisable");
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="space-y-3">
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => void handle(e.target.files?.[0])}
      />
      {busy ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-white p-6 ring-1 ring-stone-200">
          {preview && <img src={preview} alt="" className="max-h-48 rounded-xl object-contain" />}
          <div className="flex items-center gap-2 text-brand-700">
            <Spinner className="h-5 w-5" />
            <span className="font-medium">{busy === "compress" ? "Préparation de la photo…" : "Lecture en cours…"}</span>
          </div>
        </div>
      ) : (
        <Button className="w-full py-4 text-lg" onClick={() => input.current?.click()}>
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" />
            <circle cx="12" cy="13" r="3" />
          </svg>
          {label}
        </Button>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {!busy && (
        <ul className="space-y-1 text-sm text-stone-500">
          {tips.map((t) => (
            <li key={t}>• {t}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
