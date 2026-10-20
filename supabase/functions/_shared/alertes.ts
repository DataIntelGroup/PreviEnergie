// Règles d'alerte (BF-16 à BF-20), en fonctions pures : la tâche horaire
// leur passe l'état d'un compteur et reçoit la liste des envois à faire.

import { formatChange, type WeeklySummary } from "./bilan.ts";
import type { Forecast, MeterKind } from "./prevision.ts";
import {
  type AlertType,
  type Channel,
  CHANNELS,
  fillTemplate,
  type Settings,
} from "./reglages.ts";
import { addDays, abidjanInstant, HOUR_MS, inQuietHours, isoWeekKey, localParts, parseHHMM, TIME_ZONE, weekday } from "./temps.ts";

export interface SentAlert {
  type: AlertType;
  cycleKey: string;
}

export interface AlertContext {
  now: Date;
  meter: { id: string; name: string; kind: MeterKind; createdAt: string };
  firstName: string;
  forecast: Forecast;
  settings: Settings;
  quiet: { start: string; end: string };
  /** Canaux que l'utilisateur a activés (et consentis pour WhatsApp et SMS). */
  userChannels: Channel[];
  /** Canaux inclus dans son offre. */
  planChannels: Channel[];
  /** Alertes déjà parties pour ce compteur et ce destinataire (tous canaux confondus). */
  sent: SentAlert[];
  /** Bilan des 7 derniers jours (BF-21), et choix de l'abonné de le recevoir. */
  weekly?: WeeklySummary | null;
  weeklyEnabled?: boolean;
}

export interface PlannedAlert {
  type: AlertType;
  cycleKey: string;
  channels: Channel[];
  message: string;
}

/** Ordre de gravité des alertes de niveau : la plus grave l'emporte. */
const LEVELS: AlertType[] = ["niveau_j5", "niveau_j2", "veille"];

export function channelsFor(type: AlertType, ctx: Pick<AlertContext, "settings" | "userChannels" | "planChannels">): Channel[] {
  return CHANNELS.filter(
    (c) =>
      ctx.planChannels.includes(c) &&
      ctx.userChannels.includes(c) &&
      ctx.settings.channelTypes[c].includes(type),
  );
}

/** Cycle d'alerte : la recharge en cours en prépayé, le mois en postpayé. */
export function alertCycleKey(kind: MeterKind, forecast: Forecast, now: Date): string {
  return kind === "prepaid" ? forecast.cycleKey : localParts(now).date.slice(0, 7);
}

/** Niveau atteint d'après les jours restants, ou null. */
export function levelFor(forecast: Forecast, settings: Settings, now: Date): AlertType | null {
  if (forecast.daysRemaining === null || forecast.cutoffAt === null) return null;
  // Veille : la coupure tombe avant la prochaine heure d'alerte, ce soir est la dernière occasion.
  const tomorrow = addDays(localParts(now).date, 1);
  const nextAlert = abidjanInstant(tomorrow, settings.hours.alert);
  if (new Date(forecast.cutoffAt) <= nextAlert) return "veille";
  if (forecast.daysRemaining <= settings.thresholds.j2) return "niveau_j2";
  if (forecast.daysRemaining <= settings.thresholds.j5) return "niveau_j5";
  return null;
}

export function planAlerts(ctx: AlertContext): PlannedAlert[] {
  const { now, forecast, settings, meter } = ctx;
  const local = localParts(now);
  if (inQuietHours(local.minutes, ctx.quiet.start, ctx.quiet.end)) return [];

  const cycleKey = alertCycleKey(meter.kind, forecast, now);
  const sentInCycle = new Set(ctx.sent.filter((s) => s.cycleKey === cycleKey).map((s) => s.type));
  const out: PlannedAlert[] = [];
  const push = (type: AlertType, key: string) => {
    const channels = channelsFor(type, ctx);
    if (channels.length === 0) return;
    out.push({ type, cycleKey: key, channels, message: renderMessage(type, ctx) });
  };

  // Alertes de niveau, à partir de 18 h (BF-16). Prépayé uniquement.
  if (meter.kind === "prepaid" && forecast.status !== "insufficient" && local.minutes >= parseHHMM(settings.hours.alert)) {
    const level = levelFor(forecast, settings, now);
    if (level) {
      const rank = LEVELS.indexOf(level);
      const alreadyAtOrAbove = LEVELS.slice(rank).some((l) => sentInCycle.has(l));
      if (!alreadyAtOrAbove) push(level, cycleKey);
    }
  }

  // Rappel de 21 h après une alerte de veille, tant que la coupure n'est pas passée.
  if (
    meter.kind === "prepaid" &&
    sentInCycle.has("veille") &&
    !sentInCycle.has("veille_rappel") &&
    local.minutes >= parseHHMM(settings.hours.reminder) &&
    forecast.cutoffAt !== null &&
    new Date(forecast.cutoffAt) > now
  ) {
    push("veille_rappel", cycleKey);
  }

  // Relance de relevé à 19 h, une fois par jour (BF-17).
  if (local.minutes >= parseHHMM(settings.hours.reading)) {
    const learning = forecast.status !== "standard";
    const limitH = learning ? settings.readingReminderHours.learning : settings.readingReminderHours.standard;
    const since = forecast.lastReading?.takenAt ?? meter.createdAt;
    const hours = (now.getTime() - new Date(since).getTime()) / HOUR_MS;
    const dayKey = `jour:${local.date}`;
    const already = ctx.sent.some((s) => s.type === "releve" && s.cycleKey === dayKey);
    if (hours >= limitH && !already) push("releve", dayKey);
  }

  // Consommation anormale (BF-18), une fois par cycle.
  if (forecast.anomaly && !sentInCycle.has("anomalie")) push("anomalie", cycleKey);

  // Bilan de la semaine (BF-21), une fois par semaine, le jour réglé.
  const w = settings.weeklySummary;
  if (ctx.weeklyEnabled !== false && ctx.weekly && weekday(local.date) === w.weekday && local.minutes >= parseHHMM(w.time)) {
    const weekKey = `semaine:${isoWeekKey(local.date)}`;
    if (!ctx.sent.some((s) => s.type === "bilan" && s.cycleKey === weekKey)) push("bilan", weekKey);
  }

  return out;
}

const dateFmt = new Intl.DateTimeFormat("fr-FR", {
  timeZone: TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
});
const hourFmt = new Intl.DateTimeFormat("fr-FR", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function formatCutoffDate(iso: string): string {
  return dateFmt.format(new Date(iso));
}

export function formatCutoffHour(iso: string): string {
  return hourFmt.format(new Date(iso)).replace(":", " h ");
}

const kwhFmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const fcfaFmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

export function renderMessage(type: AlertType, ctx: Pick<AlertContext, "forecast" | "settings" | "meter" | "firstName" | "weekly">): string {
  const f = ctx.forecast;
  const days = f.daysRemaining === null ? "" : String(Math.max(1, Math.round(f.daysRemaining)));
  const w = ctx.weekly;
  return fillTemplate(ctx.settings.templates[type], {
    kwh: w ? `${kwhFmt.format(w.kwh)} kWh` : "",
    evolution: w ? formatChange(w.change) : "",
    depense: w ? `${fcfaFmt.format(w.spendFcfa)} FCFA` : "",
    nom: ctx.firstName,
    compteur: ctx.meter.name,
    jours: days,
    date: f.cutoffAt ? formatCutoffDate(f.cutoffAt) : "",
    heure: f.cutoffAt ? formatCutoffHour(f.cutoffAt) : "",
  });
}
