// Rédaction et envoi d'un message de l'équipe (notification push, email) à
// un client ou à un groupe. Le serveur (fonction admin-clients) vérifie le
// rôle administrateur, choisit les destinataires et journalise l'envoi.
import { MESSAGE_LIMITS, MESSAGE_LINKS, type MessageLink, personalize, type Segment } from "@shared/segments.ts";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { Logo } from "@/components/Layout";
import { Button, Field, Input, Notice, Select, Spinner, useToast } from "@/components/ui";
import { callFunction } from "@/lib/supabase";

export type Target = { userId: string } | { segment: Segment };
type Channel = "push" | "email";

interface Preview {
  recipients: number;
  withPush: number;
  withEmail: number;
  quietNow: number;
  available: Channel[];
}
export interface SendStats {
  recipients: number;
  quiet: number;
  push: { sent: number; failed: number; noDevice: number };
  email: { sent: number; failed: number; noAddress: number };
}

const textareaClass =
  "block w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-base focus:border-brand-500 focus:ring-2 focus:ring-brand-200 focus:outline-none";

/** Aperçu de la notification telle qu'elle s'affiche sur un téléphone. */
function NotificationPreview({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-3xl bg-gradient-to-br from-stone-800 to-stone-900 p-3 shadow-inner">
      <div className="flex gap-3 rounded-2xl bg-white/90 p-3 backdrop-blur">
        <Logo className="h-9 w-9 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2 text-[11px] text-stone-500">
            <span className="font-semibold tracking-wide uppercase">PréviÉnergie</span>
            <span>maintenant</span>
          </div>
          <p className="truncate text-sm font-bold text-stone-900">{title || "Titre de la notification"}</p>
          <p className="line-clamp-3 text-sm text-stone-700">{body || "Ton message apparaîtra ici."}</p>
        </div>
      </div>
    </div>
  );
}

export function MessageComposer({
  target,
  defaults,
  firstName = "Aya",
  confirmLabel,
  onSent,
}: {
  target: Target;
  defaults: { title: string; body: string; link: MessageLink };
  /** Prénom utilisé pour l'aperçu de {prenom}. */
  firstName?: string | null;
  /** Texte de confirmation demandé avant un envoi groupé. */
  confirmLabel?: (n: number) => string;
  onSent?: (s: SendStats) => void;
}) {
  const toast = useToast();
  const single = "userId" in target;
  const [title, setTitle] = useState(defaults.title);
  const [body, setBody] = useState(defaults.body);
  const [link, setLink] = useState<MessageLink>(defaults.link);
  const [channels, setChannels] = useState<Channel[]>(["push"]);
  const [respectQuiet, setRespectQuiet] = useState(!single);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<SendStats | null>(null);
  const key = JSON.stringify(target);

  useEffect(() => {
    setTitle(defaults.title);
    setBody(defaults.body);
    setLink(defaults.link);
    setResult(null);
    setConfirming(false);
    setPreview(null);
    setError(null);
    callFunction<Preview>("admin-clients", { action: "apercu", target })
      .then(setPreview)
      .catch((e: Error) => setError(e.message));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (c: Channel) => setChannels((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]));
  const valid = title.trim() && body.trim() && title.length <= MESSAGE_LIMITS.title && body.length <= MESSAGE_LIMITS.body && channels.length > 0;

  async function send() {
    if (!single && !confirming) return setConfirming(true);
    setBusy(true);
    setError(null);
    try {
      const s = await callFunction<SendStats>("admin-clients", { action: "envoyer", target, title, body, link, channels, respectQuiet });
      setResult(s);
      setConfirming(false);
      const sent = s.push.sent + s.email.sent;
      toast(sent > 0 ? `Message envoyé (${sent})` : "Aucun message n'a pu partir", sent > 0 ? "success" : "error");
      onSent?.(s);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!preview && !error) {
    return <div className="flex justify-center py-8 text-brand-600"><Spinner /></div>;
  }

  const pushOn = preview?.available.includes("push");
  const emailOn = preview?.available.includes("email");
  const n = preview?.recipients ?? 0;

  return (
    <div className="space-y-4">
      {preview && (
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            [single ? "Client" : "Destinataires", n],
            ["Appareils abonnés", preview.withPush],
            ["En heures calmes", preview.quietNow],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl bg-brand-50 px-2 py-3 ring-1 ring-brand-100">
              <p className="tabular text-2xl font-extrabold text-brand-700">{value}</p>
              <p className="text-xs text-stone-600">{label}</p>
            </div>
          ))}
        </div>
      )}

      {preview && pushOn && preview.withPush === 0 && channels.includes("push") && (
        <Notice tone="warning">
          {single
            ? "Ce client n'a activé les notifications sur aucun appareil : la notification ne peut pas lui parvenir. Il doit les activer dans Alertes, sur son téléphone."
            : "Personne dans ce groupe n'a activé les notifications sur son téléphone."}
        </Notice>
      )}

      <Field label={`Titre (${title.length}/${MESSAGE_LIMITS.title})`}>
        {(id) => <Input id={id} value={title} maxLength={MESSAGE_LIMITS.title} onChange={(e) => setTitle(e.target.value)} />}
      </Field>
      <Field label={`Message (${body.length}/${MESSAGE_LIMITS.body})`} hint="{prenom} est remplacé par le prénom de chaque client.">
        {(id) => <textarea id={id} rows={4} maxLength={MESSAGE_LIMITS.body} className={textareaClass} value={body} onChange={(e) => setBody(e.target.value)} />}
      </Field>
      <Field label="Le message ouvre">
        {(id) => (
          <Select id={id} value={link} onChange={(e) => setLink(e.target.value as MessageLink)}>
            {(Object.keys(MESSAGE_LINKS) as MessageLink[]).map((l) => <option key={l} value={l}>{MESSAGE_LINKS[l]}</option>)}
          </Select>
        )}
      </Field>

      <div>
        <p className="mb-2 text-sm font-medium text-stone-700">Aperçu</p>
        <NotificationPreview title={personalize(title, firstName)} body={personalize(body, firstName)} />
      </div>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium text-stone-700">Canaux</legend>
        <label className={`flex items-center gap-3 rounded-xl p-3 ring-1 ${pushOn ? "ring-stone-200" : "opacity-60 ring-stone-100"}`}>
          <input type="checkbox" className="h-5 w-5 accent-brand-600" disabled={!pushOn} checked={channels.includes("push")} onChange={() => toggle("push")} />
          <Icon name="bell" className="h-5 w-5 text-brand-600" />
          <span className="text-sm">
            <span className="font-semibold">Notification push</span>
            <span className="block text-stone-500">{pushOn ? "Gratuite, arrive sur le téléphone ou l'ordinateur abonné." : "Clés VAPID absentes côté serveur."}</span>
          </span>
        </label>
        <label className={`flex items-center gap-3 rounded-xl p-3 ring-1 ${emailOn ? "ring-stone-200" : "opacity-60 ring-stone-100"}`}>
          <input type="checkbox" className="h-5 w-5 accent-brand-600" disabled={!emailOn} checked={channels.includes("email")} onChange={() => toggle("email")} />
          <Icon name="mail" className="h-5 w-5 text-brand-600" />
          <span className="text-sm">
            <span className="font-semibold">Email</span>
            <span className="block text-stone-500">{emailOn ? `${preview?.withEmail ?? 0} adresse(s).` : "Pas encore configuré : il faut un compte Resend ou Brevo (EMAIL_API_KEY, EMAIL_FROM)."}</span>
          </span>
        </label>
      </fieldset>

      <label className="flex items-center gap-3 text-sm">
        <input type="checkbox" className="h-5 w-5 accent-brand-600" checked={respectQuiet} onChange={(e) => setRespectQuiet(e.target.checked)} />
        Ne pas déranger pendant les heures calmes de chaque client (21 h 30 – 7 h par défaut)
      </label>

      {error && <Notice tone="error">{error}</Notice>}

      {result && (
        <Notice tone={result.push.sent + result.email.sent > 0 ? "success" : "warning"}>
          {result.push.sent > 0 && `${result.push.sent} notification(s) remise(s). `}
          {result.push.failed > 0 && `${result.push.failed} échec(s) push. `}
          {result.push.noDevice > 0 && `${result.push.noDevice} client(s) sans appareil abonné. `}
          {result.email.sent > 0 && `${result.email.sent} email(s) envoyé(s). `}
          {result.email.failed > 0 && `${result.email.failed} échec(s) email. `}
          {result.quiet > 0 && `${result.quiet} client(s) en heures calmes, non dérangé(s).`}
          {result.push.sent + result.email.sent === 0 && result.push.noDevice + result.quiet === 0 && "Aucun envoi."}
        </Notice>
      )}

      {confirming ? (
        <div className="space-y-2 rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
          <p className="text-sm font-semibold text-amber-900">{confirmLabel ? confirmLabel(n) : `Envoyer à ${n} client(s) ?`}</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setConfirming(false)}>Annuler</Button>
            <Button loading={busy} onClick={() => void send()}>Confirmer l'envoi</Button>
          </div>
        </div>
      ) : (
        <Button className="w-full" disabled={!valid || n === 0} loading={busy} onClick={() => void send()}>
          <Icon name="bell" className="h-5 w-5" /> {single ? "Envoyer au client" : `Envoyer à ${n} client${n > 1 ? "s" : ""}`}
        </Button>
      )}
    </div>
  );
}
