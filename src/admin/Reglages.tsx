// Réglages sans redéploiement (BF-31) : chaque bloc s'enregistre seul, via
// admin_set_setting, et chaque changement est inscrit au journal.
import {
  ALERT_LABELS,
  ALERT_TYPES,
  type AlertType,
  type Channel,
  CHANNEL_LABELS,
  CHANNELS,
  DEFAULT_SETTINGS,
  resolveSettings,
  type Settings,
} from "@shared/reglages.ts";
import { isCinetPayAmount } from "@shared/validation.ts";
import { type ReactNode, useEffect, useState } from "react";
import { Button, Card, Field, Input, Notice, Spinner, useToast } from "@/components/ui";
import { errorMessage, supabase } from "@/lib/supabase";
import type { Plan } from "@/lib/types";
import { useAdmin } from "./AdminApp";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function Block({ title, desc, children, onSave, onReset, dirty, readOnly }: {
  title: string; desc?: string; children: ReactNode; onSave: () => Promise<void>; onReset: () => void; dirty: boolean; readOnly: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Card className="space-y-4">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {desc && <p className="text-sm text-stone-500">{desc}</p>}
      </div>
      {children}
      {!readOnly && (
        <div className="flex gap-2">
          <Button loading={busy} disabled={!dirty} onClick={async () => { setBusy(true); await onSave(); setBusy(false); }}>Enregistrer</Button>
          <Button variant="ghost" onClick={onReset}>Valeurs par défaut</Button>
        </div>
      )}
    </Card>
  );
}

const numberInput = (v: number, set: (n: number) => void, opts: { step?: number; min?: number; disabled?: boolean } = {}) => (id: string) => (
  <Input id={id} type="number" inputMode="decimal" step={opts.step ?? 1} min={opts.min ?? 0} value={Number.isFinite(v) ? v : ""} disabled={opts.disabled}
    onChange={(e) => set(e.target.value === "" ? Number.NaN : Number(e.target.value))} />
);

export default function Reglages() {
  const { isAdmin } = useAdmin();
  const toast = useToast();
  const [saved, setSaved] = useState<Settings | null>(null);
  const [s, setS] = useState<Settings | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [planDraft, setPlanDraft] = useState<Record<string, Plan>>({});
  const ro = !isAdmin;

  const load = async () => {
    const [st, pl] = await Promise.all([supabase.from("settings").select("key, value"), supabase.from("plans").select("*").order("sort")]);
    const resolved = resolveSettings(st.data);
    setSaved(resolved);
    setS(structuredClone(resolved));
    setPlans((pl.data as Plan[]) ?? []);
    setPlanDraft(Object.fromEntries(((pl.data as Plan[]) ?? []).map((p) => [p.code, { ...p }])));
  };
  useEffect(() => {
    void load();
  }, []);

  if (!s || !saved) return <div className="flex justify-center py-20 text-brand-600"><Spinner /></div>;

  const patch = <K extends keyof Settings>(key: K, value: Settings[K]) => setS({ ...s, [key]: value });
  const dirty = (key: keyof Settings) => JSON.stringify(s[key]) !== JSON.stringify(saved[key]);

  async function save<K extends keyof Settings>(key: K, validate?: (v: Settings[K]) => string | null) {
    const value = s![key];
    const problem = validate?.(value);
    if (problem) return toast(problem, "error");
    // Valeur par défaut : on supprime la ligne plutôt que de la recopier.
    const isDefault = JSON.stringify(value) === JSON.stringify(DEFAULT_SETTINGS[key]);
    const { error } = await supabase.rpc("admin_set_setting", { p_key: key, p_value: isDefault ? null : value });
    if (error) return toast(errorMessage(error), "error");
    toast("Réglage enregistré");
    await load();
  }

  const reset = (key: keyof Settings) => patch(key, structuredClone(DEFAULT_SETTINGS[key]));

  async function savePlan(code: string) {
    const p = planDraft[code];
    if (!isCinetPayAmount(p.price_fcfa) && p.price_fcfa !== 0) return toast("Le prix doit être un multiple de 5 FCFA (contrainte CinetPay).", "error");
    if (!p.channels.length) return toast("Une offre doit avoir au moins un canal.", "error");
    const { error } = await supabase.rpc("admin_update_plan", {
      p_code: code, p_name: p.name, p_description: p.description, p_price_fcfa: p.price_fcfa, p_max_meters: p.max_meters,
      p_channels: p.channels, p_history_days: p.history_days, p_active: p.active,
    });
    if (error) return toast(errorMessage(error), "error");
    toast(`Offre ${p.name} enregistrée`);
    await load();
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-2xl font-bold">Réglages</h1>
      {ro && <Notice>Rôle support : lecture seule.</Notice>}

      <Block title="Seuils des alertes" desc="Jours restants qui déclenchent les alertes de niveau." dirty={dirty("thresholds")} readOnly={ro}
        onReset={() => reset("thresholds")}
        onSave={() => save("thresholds", (v) => (v.j2 > 0 && v.j5 > v.j2 ? null : "Le seuil « 5 jours » doit être supérieur au seuil « 2 jours »."))}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Première alerte (jours)">{numberInput(s.thresholds.j5, (n) => patch("thresholds", { ...s.thresholds, j5: n }), { step: 0.5, disabled: ro })}</Field>
          <Field label="Deuxième alerte (jours)">{numberInput(s.thresholds.j2, (n) => patch("thresholds", { ...s.thresholds, j2: n }), { step: 0.5, disabled: ro })}</Field>
        </div>
      </Block>

      <Block title="Heures d'envoi" desc="Heure d'Abidjan. La tâche passe chaque heure : une alerte manquée part au passage suivant, hors heures calmes." dirty={dirty("hours")} readOnly={ro}
        onReset={() => reset("hours")}
        onSave={() => save("hours", (v) => (Object.values(v).every((h) => HHMM.test(h)) ? null : "Heure au format HH:MM."))}>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Alertes de niveau">{(id) => <Input id={id} type="time" disabled={ro} value={s.hours.alert} onChange={(e) => patch("hours", { ...s.hours, alert: e.target.value })} />}</Field>
          <Field label="Rappel de veille">{(id) => <Input id={id} type="time" disabled={ro} value={s.hours.reminder} onChange={(e) => patch("hours", { ...s.hours, reminder: e.target.value })} />}</Field>
          <Field label="Relance de relevé">{(id) => <Input id={id} type="time" disabled={ro} value={s.hours.reading} onChange={(e) => patch("hours", { ...s.hours, reading: e.target.value })} />}</Field>
        </div>
      </Block>

      <Block title="Prévision" dirty={dirty("safetyMargin") || dirty("anomalyRatio") || dirty("defaultPriceKwh") || dirty("readingReminderHours")} readOnly={ro}
        onReset={() => setS({ ...s, safetyMargin: DEFAULT_SETTINGS.safetyMargin, anomalyRatio: DEFAULT_SETTINGS.anomalyRatio, defaultPriceKwh: DEFAULT_SETTINGS.defaultPriceKwh, readingReminderHours: { ...DEFAULT_SETTINGS.readingReminderHours } })}
        onSave={async () => {
          if (dirty("safetyMargin")) await save("safetyMargin", (v) => (v >= 0 && v <= 1 ? null : "Marge entre 0 et 100 %."));
          if (dirty("anomalyRatio")) await save("anomalyRatio", (v) => (v > 1 ? null : "Le rapport doit dépasser 1."));
          if (dirty("defaultPriceKwh")) await save("defaultPriceKwh", (v) => (v > 0 ? null : "Prix positif."));
          if (dirty("readingReminderHours")) await save("readingReminderHours", (v) => (v.learning >= 6 && v.standard >= v.learning ? null : "Délais invalides."));
        }}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Field label="Marge de sécurité (%)">{numberInput(Math.round(s.safetyMargin * 100), (n) => patch("safetyMargin", n / 100), { disabled: ro })}</Field>
          <Field label="Anomalie : × la moyenne">{numberInput(s.anomalyRatio, (n) => patch("anomalyRatio", n), { step: 0.1, disabled: ro })}</Field>
          <Field label="Prix par défaut (FCFA/kWh)">{numberInput(s.defaultPriceKwh, (n) => patch("defaultPriceKwh", n), { disabled: ro })}</Field>
          <Field label="Relance (h) : apprentissage / ensuite">
            {(id) => (
              <div className="flex gap-2">
                <Input id={id} type="number" disabled={ro} value={s.readingReminderHours.learning} onChange={(e) => patch("readingReminderHours", { ...s.readingReminderHours, learning: Number(e.target.value) })} />
                <Input type="number" disabled={ro} aria-label="Relance après l'apprentissage" value={s.readingReminderHours.standard} onChange={(e) => patch("readingReminderHours", { ...s.readingReminderHours, standard: Number(e.target.value) })} />
              </div>
            )}
          </Field>
        </div>
      </Block>

      <Block title="Bilan de la semaine" desc="Jour et heure d'envoi du bilan hebdomadaire (heure d'Abidjan). Chaque abonné peut le désactiver." dirty={dirty("weeklySummary")} readOnly={ro}
        onReset={() => reset("weeklySummary")}
        onSave={() => save("weeklySummary", (v) => (HHMM.test(v.time) && v.weekday >= 0 && v.weekday <= 6 ? null : "Jour ou heure invalide."))}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Jour">
            {(id) => (
              <select id={id} disabled={ro} value={s.weeklySummary.weekday} onChange={(e) => patch("weeklySummary", { ...s.weeklySummary, weekday: Number(e.target.value) })}
                className="block min-h-12 w-full rounded-xl border border-stone-300 bg-white px-4 disabled:bg-stone-100">
                {["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"].map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
            )}
          </Field>
          <Field label="Heure">{(id) => <Input id={id} type="time" disabled={ro} value={s.weeklySummary.time} onChange={(e) => patch("weeklySummary", { ...s.weeklySummary, time: e.target.value })} />}</Field>
        </div>
      </Block>

      <Block title="Types d'alerte par canal" desc="Le SMS, payant, reste réservé aux alertes urgentes." dirty={dirty("channelTypes")} readOnly={ro}
        onReset={() => reset("channelTypes")} onSave={() => save("channelTypes")}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr><th className="py-2 text-left font-medium text-stone-500">Type</th>{CHANNELS.map((c) => <th key={c} className="px-2 font-medium text-stone-500">{CHANNEL_LABELS[c]}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {ALERT_TYPES.map((t) => (
                <tr key={t}>
                  <td className="py-2">{ALERT_LABELS[t]}</td>
                  {CHANNELS.map((c: Channel) => (
                    <td key={c} className="px-2 text-center">
                      <input type="checkbox" className="h-5 w-5 accent-brand-600" disabled={ro} aria-label={`${ALERT_LABELS[t]} par ${CHANNEL_LABELS[c]}`}
                        checked={s.channelTypes[c].includes(t)}
                        onChange={(e) => patch("channelTypes", { ...s.channelTypes, [c]: e.target.checked ? [...s.channelTypes[c], t] : s.channelTypes[c].filter((x) => x !== t) })} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Block>

      <Block title="Coûts unitaires (FCFA)" desc="Servent au tableau des coûts et de la marge." dirty={dirty("unitCosts")} readOnly={ro}
        onReset={() => reset("unitCosts")} onSave={() => save("unitCosts", (v) => (Object.values(v).every((n) => Number.isFinite(n) && n >= 0) ? null : "Coûts positifs."))}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {(["whatsapp", "sms", "email", "push", "aiRead"] as const).map((k) => (
            <Field key={k} label={k === "aiRead" ? "Lecture IA" : CHANNEL_LABELS[k]}>
              {numberInput(s.unitCosts[k], (n) => patch("unitCosts", { ...s.unitCosts, [k]: n }), { step: 0.5, disabled: ro })}
            </Field>
          ))}
        </div>
      </Block>

      <Block title="Modèles de messages" desc="Variables : {nom}, {compteur}, {jours}, {date}, {heure}. Les modèles WhatsApp doivent rester conformes au modèle validé par Meta." dirty={dirty("templates")} readOnly={ro}
        onReset={() => reset("templates")} onSave={() => save("templates", (v) => (Object.values(v).every((t) => t.trim().length >= 10 && t.length <= 300) ? null : "Chaque message fait entre 10 et 300 caractères."))}>
        {ALERT_TYPES.map((t: AlertType) => (
          <Field key={t} label={ALERT_LABELS[t]}>
            {(id) => (
              <textarea id={id} rows={2} disabled={ro} maxLength={300} value={s.templates[t]}
                onChange={(e) => patch("templates", { ...s.templates, [t]: e.target.value })}
                className="block w-full rounded-xl border border-stone-300 px-4 py-3 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-200 focus:outline-none disabled:bg-stone-100" />
            )}
          </Field>
        ))}
      </Block>

      <h2 className="pt-4 text-xl font-bold">Offres</h2>
      <div className="grid gap-4 lg:grid-cols-3">
        {plans.map((orig) => {
          const p = planDraft[orig.code];
          const set = (patchPlan: Partial<Plan>) => setPlanDraft({ ...planDraft, [orig.code]: { ...p, ...patchPlan } });
          const changed = JSON.stringify(p) !== JSON.stringify(orig);
          const free = orig.code === "gratuit";
          return (
            <Card key={orig.code} className="space-y-3">
              <Field label="Nom">{(id) => <Input id={id} disabled={ro} value={p.name} onChange={(e) => set({ name: e.target.value })} />}</Field>
              <Field label="Description">{(id) => <Input id={id} disabled={ro} value={p.description} onChange={(e) => set({ description: e.target.value })} />}</Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Prix / mois (FCFA)">{numberInput(p.price_fcfa, (n) => set({ price_fcfa: n }), { step: 5, disabled: ro || free })}</Field>
                <Field label="Compteurs max">{numberInput(p.max_meters, (n) => set({ max_meters: n }), { min: 1, disabled: ro })}</Field>
              </div>
              <Field label="Historique (jours, vide = illimité)">
                {(id) => <Input id={id} type="number" disabled={ro} value={p.history_days ?? ""} onChange={(e) => set({ history_days: e.target.value ? Number(e.target.value) : null })} />}
              </Field>
              <fieldset>
                <legend className="mb-1 text-sm font-medium text-stone-700">Canaux inclus</legend>
                <div className="flex flex-wrap gap-3">
                  {CHANNELS.map((c) => (
                    <label key={c} className="flex items-center gap-1.5 text-sm">
                      <input type="checkbox" className="h-4 w-4 accent-brand-600" disabled={ro} checked={p.channels.includes(c)}
                        onChange={(e) => set({ channels: e.target.checked ? [...p.channels, c] : p.channels.filter((x) => x !== c) })} />
                      {CHANNEL_LABELS[c]}
                    </label>
                  ))}
                </div>
              </fieldset>
              {!free && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4 accent-brand-600" disabled={ro} checked={p.active} onChange={(e) => set({ active: e.target.checked })} />
                  Proposée à la vente
                </label>
              )}
              {!ro && <Button className="w-full" disabled={!changed} onClick={() => void savePlan(orig.code)}>Enregistrer l'offre</Button>}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
