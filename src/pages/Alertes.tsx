// Préférences d'alerte (BF-19, BF-20) : canaux selon l'offre, consentement
// WhatsApp et SMS, heures calmes, essai d'envoi, dernières alertes.
import { ALERT_LABELS, type AlertType, type Channel, CHANNEL_LABELS } from "@shared/reglages.ts";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Card, Field, Input, Notice, PageTitle, Toggle, useToast } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useData } from "@/lib/data";
import { fmtDateTime } from "@/lib/format";
import { disablePush, enablePush, isIos, pushState, type PushState } from "@/lib/push";
import { callFunction, errorMessage, supabase } from "@/lib/supabase";
import type { AlertRow } from "@/lib/types";
import { R } from "@/lib/routes";

const WEEKDAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

const DESCRIPTIONS: Record<Channel, string> = {
  push: "Gratuit, sur ce téléphone.",
  email: "Gratuit, à ton adresse de connexion.",
  whatsapp: "J'accepte de recevoir mes alertes PréviÉnergie par WhatsApp.",
  sms: "Alertes urgentes seulement (2 jours, veille de coupure). J'accepte de les recevoir par SMS.",
};

export default function Alertes() {
  const { profile, refreshProfile } = useAuth();
  const { currentPlan, meters, settings } = useData();
  const toast = useToast();
  const [push, setPush] = useState<PushState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [quietStart, setQuietStart] = useState(profile?.quiet_start ?? "21:30");
  const [quietEnd, setQuietEnd] = useState(profile?.quiet_end ?? "07:00");
  const [recent, setRecent] = useState<AlertRow[]>([]);

  useEffect(() => {
    pushState().then(setPush).catch(() => setPush("unsupported"));
    supabase.from("alerts").select("id, meter_id, type, channel, status, message, sent_at").eq("user_id", profile!.id).neq("type", "test")
      .order("sent_at", { ascending: false }).limit(10)
      .then(({ data }) => setRecent((data as AlertRow[]) ?? []));
  }, []);

  if (!profile) return null;
  const planChannels = currentPlan?.channels ?? ["push", "email"];

  async function update(patch: Record<string, unknown>, ok?: string) {
    const { error } = await supabase.from("profiles").update(patch).eq("id", profile!.id);
    if (error) return toast(errorMessage(error), "error");
    await refreshProfile();
    if (ok) toast(ok);
  }

  async function toggleChannel(c: Channel, on: boolean) {
    const channels = on ? [...new Set([...profile!.channels, c])] : profile!.channels.filter((x) => x !== c);
    const patch: Record<string, unknown> = { channels };
    if (c === "whatsapp") patch.whatsapp_consent_at = on ? new Date().toISOString() : null;
    if (c === "sms") patch.sms_consent_at = on ? new Date().toISOString() : null;
    setBusy(c);
    if (c === "push") {
      try {
        if (on) await enablePush();
        else await disablePush();
        setPush(await pushState());
      } catch (e) {
        setBusy(null);
        return toast(errorMessage(e), "error");
      }
    }
    await update(patch);
    setBusy(null);
  }

  async function test(c: Channel) {
    setBusy(`test-${c}`);
    try {
      await callFunction("test-notification", { channel: c });
      toast(c === "push" ? "Notification envoyée" : `Message de test envoyé par ${CHANNEL_LABELS[c]}`);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  }

  const meterName = (id: string | null) => meters.find((m) => m.id === id)?.name ?? "";

  return (
    <div className="space-y-4">
      <PageTitle>Alertes</PageTitle>
      <p className="text-stone-600">
        Je te préviens à 18 h quand il reste environ 5 jours, puis 2 jours, puis la veille de la coupure (avec un rappel à 21 h). Une seule alerte de chaque sorte par recharge.
      </p>

      {push === "ios-install" && (
        <Notice>
          <p className="font-semibold">Sur iPhone (iOS 16.4 ou plus)</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5">
            <li>Ouvre PréviÉnergie dans Safari.</li>
            <li>Touche le bouton Partager, puis « Sur l'écran d'accueil ».</li>
            <li>Ouvre l'app depuis l'écran d'accueil et reviens ici activer les notifications.</li>
          </ol>
        </Notice>
      )}
      {push === "denied" && <Notice tone="warning">Les notifications sont bloquées pour ce site. Autorise-les dans les réglages du navigateur.</Notice>}

      <div className="grid gap-6 lg:grid-cols-5">
      <div className="space-y-6 lg:col-span-3">
      <Card className="p-5">
        <h2 className="font-semibold">Canaux</h2>
        <div className="divide-y divide-stone-100">
          {(["push", "email", "whatsapp", "sms"] as Channel[]).map((c) => {
            const included = planChannels.includes(c);
            const on = c === "push" ? push === "on" && profile.channels.includes("push") : profile.channels.includes(c) && (c !== "whatsapp" || !!profile.whatsapp_consent_at) && (c !== "sms" || !!profile.sms_consent_at);
            const unavailable = c === "push" && (push === "unsupported" || push === "ios-install" || push === "denied" || push === "unconfigured");
            return (
              <div key={c}>
                <Toggle
                  label={CHANNEL_LABELS[c]}
                  description={included ? DESCRIPTIONS[c] : "Inclus dans les offres Essentiel et Famille / Pro."}
                  checked={on && included}
                  disabled={!included || unavailable || busy === c}
                  onChange={(v) => void toggleChannel(c, v)}
                />
                {on && included && (
                  <button className="-mt-2 mb-2 text-sm font-medium text-brand-700 disabled:text-stone-400" disabled={busy === `test-${c}`} onClick={() => void test(c)}>
                    {busy === `test-${c}` ? "Envoi…" : "Envoyer un essai"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {!planChannels.includes("whatsapp") && (
          <Link to={R.offres} className="mt-2 block text-sm font-semibold text-brand-700">Recevoir aussi mes alertes par WhatsApp et SMS →</Link>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold">Heures calmes</h2>
        <p className="mb-3 text-sm text-stone-500">Aucune alerte pendant cette plage.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="De">{(id) => <Input id={id} type="time" value={quietStart} onChange={(e) => setQuietStart(e.target.value)} />}</Field>
          <Field label="À">{(id) => <Input id={id} type="time" value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} />}</Field>
        </div>
        <Button
          variant="secondary"
          className="mt-3 w-full"
          disabled={quietStart === profile.quiet_start && quietEnd === profile.quiet_end}
          onClick={() => void update({ quiet_start: quietStart, quiet_end: quietEnd }, "Heures calmes enregistrées")}
        >
          Enregistrer
        </Button>
      </Card>

      <Card className="p-5">
        <Toggle
          label="Bilan de la semaine"
          description={`Chaque ${WEEKDAYS[settings.weeklySummary.weekday]} à ${settings.weeklySummary.time.replace(":", " h ")} : ta consommation, l'évolution et tes recharges de la semaine.`}
          checked={profile.weekly_summary}
          onChange={(v) => void update({ weekly_summary: v }, v ? "Bilan hebdomadaire activé" : "Bilan hebdomadaire désactivé")}
        />
      </Card>
      </div>

      <div className="space-y-4 lg:col-span-2">
        <div className="rounded-2xl bg-stone-900 p-5 text-white">
          <p className="font-bold">Le calendrier des alertes</p>
          <ul className="mt-3 space-y-2 text-sm text-stone-300">
            <li><span className="font-semibold text-white">18 h</span> · environ 5 jours, puis 2 jours, puis la veille</li>
            <li><span className="font-semibold text-white">21 h</span> · rappel le soir de la veille</li>
            <li><span className="font-semibold text-white">19 h</span> · relance si tu n'as pas fait de relevé</li>
          </ul>
        </div>
        <h2 className="font-semibold">Dernières alertes</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-stone-500">Aucune alerte pour l'instant.</p>
        ) : (
          <ul className="divide-y divide-stone-200 overflow-hidden rounded-2xl bg-white ring-1 ring-stone-200">
            {recent.map((a) => (
              <li key={a.id} className="px-4 py-3">
                <p className="text-sm font-medium">
                  {ALERT_LABELS[a.type as AlertType] ?? a.type} · {CHANNEL_LABELS[a.channel]}
                  {a.status === "failed" && <span className="ml-2 text-red-600">non délivrée</span>}
                </p>
                <p className="text-sm text-stone-500">{meterName(a.meter_id)} · {fmtDateTime(a.sent_at)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
      </div>
      {isIos() && push !== "ios-install" && push !== "on" && <p className="text-xs text-stone-500">Astuce : sur iPhone, les notifications ne marchent qu'avec l'app installée sur l'écran d'accueil.</p>}
    </div>
  );
}
