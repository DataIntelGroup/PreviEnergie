// Tâche horaire : expiration des offres, recalcul des prévisions, envoi des
// alertes et du bilan hebdomadaire. Appelée chaque heure par pg_cron avec
// l'en-tête x-cron-secret. Chaque compteur a un ou plusieurs destinataires :
// son propriétaire et les membres d'un partage accepté (BF-15).
import { accessStatus } from "../_shared/acces.ts";
import { planAlerts, type SentAlert } from "../_shared/alertes.ts";
import { weeklySummary } from "../_shared/bilan.ts";
import { appLink, configuredChannels, type Recipient, send } from "../_shared/canaux.ts";
import { verifyAndApply } from "../_shared/cinetpay.ts";
import { forecastFor, forecastRow, loadHistory, loadSettings, type MeterRow } from "../_shared/donnees.ts";
import { ALERT_LABELS, type AlertType, type Channel } from "../_shared/reglages.ts";
import { adminClient, env, handler, HttpError, json, requireEnv, safeEqual } from "../_shared/serveur.ts";
import { DAY_MS } from "../_shared/temps.ts";

const PROFILE_COLUMNS =
  "id, first_name, email, phone, channels, whatsapp_consent_at, sms_consent_at, quiet_start, quiet_end, suspended, plan_code, plan_expires_at, trial_ends_at, weekly_summary";

interface ProfileRow {
  id: string;
  first_name: string | null;
  email: string | null;
  phone: string | null;
  channels: Channel[];
  whatsapp_consent_at: string | null;
  sms_consent_at: string | null;
  quiet_start: string;
  quiet_end: string;
  suspended: boolean;
  plan_code: string;
  plan_expires_at: string | null;
  trial_ends_at: string;
  weekly_summary: boolean;
}

type MeterWithProfile = MeterRow & { profiles: ProfileRow };

interface Job {
  meter: MeterWithProfile;
  to: ProfileRow;
  type: AlertType;
  cycleKey: string;
  channel: Channel;
  message: string;
}

const TITLES: Record<AlertType, string> = {
  ...ALERT_LABELS,
  niveau_j5: "Environ 5 jours de courant",
  niveau_j2: "Plus que 2 jours de courant",
  veille: "Coupure possible cette nuit",
  veille_rappel: "Rappel : recharge ce soir",
  bilan: "Ta semaine en un coup d'œil",
};

function effectivePlan(p: ProfileRow, now: Date): string {
  if (p.plan_code === "gratuit") return "gratuit";
  return !p.plan_expires_at || new Date(p.plan_expires_at) > now ? p.plan_code : "gratuit";
}

/** Canaux activés par l'utilisateur, WhatsApp et SMS seulement avec consentement. */
function userChannels(p: ProfileRow): Channel[] {
  return p.channels.filter(
    (c) => (c !== "whatsapp" || p.whatsapp_consent_at) && (c !== "sms" || p.sms_consent_at),
  );
}

Deno.serve(handler(async (req) => {
  const secret = req.headers.get("x-cron-secret") ?? "";
  if (!safeEqual(secret, requireEnv("CRON_SECRET"))) throw new HttpError(401, "Secret invalide");

  const db = adminClient();
  const now = new Date();
  const settings = await loadSettings(db);
  const available = configuredChannels();

  const expired = await db.rpc("expire_plans");
  if (expired.error) throw expired.error;

  // Filet de sécurité : paiements restés en attente (notification CinetPay perdue).
  let paymentsChecked = 0;
  if (env("CINETPAY_API_KEY")) {
    const { data: pending } = await db
      .from("payments")
      .select("transaction_id")
      .eq("status", "pending")
      .lt("created_at", new Date(now.getTime() - 5 * 60_000).toISOString())
      .gt("created_at", new Date(now.getTime() - 2 * DAY_MS).toISOString())
      .limit(50);
    for (const p of pending ?? []) {
      try {
        await verifyAndApply(db, p.transaction_id);
        paymentsChecked++;
      } catch (e) {
        console.error("revérification paiement", p.transaction_id, e);
      }
    }
  }

  const { data: plans, error: plansError } = await db.from("plans").select("code, channels");
  if (plansError) throw plansError;
  const planChannels = new Map<string, Channel[]>(plans.map((p) => [p.code, p.channels as Channel[]]));

  // Tous les compteurs des comptes actifs, par pages de 1000.
  const meters: MeterWithProfile[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("meters")
      .select(`id, user_id, name, kind, created_at, profiles!inner(${PROFILE_COLUMNS})`)
      .eq("profiles.suspended", false)
      .not("profiles.phone", "is", null)
      .order("created_at")
      .range(from, from + 999);
    if (error) throw error;
    meters.push(...(data as unknown as MeterWithProfile[]));
    if (!data || data.length < 1000) break;
  }

  const ids = meters.map((m) => m.id);
  const { readings, recharges } = await loadHistory(db, ids, now);

  // Membres des partages acceptés qui veulent les alertes.
  const members = new Map<string, ProfileRow[]>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await db
      .from("meter_shares")
      .select(`meter_id, member:profiles!meter_shares_member_id_fkey(${PROFILE_COLUMNS})`)
      .in("meter_id", ids.slice(i, i + 100))
      .eq("status", "accepted")
      .eq("alerts", true);
    if (error) throw error;
    for (const s of (data ?? []) as unknown as { meter_id: string; member: ProfileRow | null }[]) {
      if (!s.member || s.member.suspended || !s.member.phone) continue;
      members.set(s.meter_id, [...(members.get(s.meter_id) ?? []), s.member]);
    }
  }

  // Alertes déjà traitées, par compteur et destinataire (45 jours suffisent : un cycle dure moins).
  const sent = new Map<string, SentAlert[]>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await db
      .from("alerts")
      .select("meter_id, user_id, type, cycle_key")
      .in("meter_id", ids.slice(i, i + 100))
      .gte("sent_at", new Date(now.getTime() - 45 * DAY_MS).toISOString());
    if (error) throw error;
    for (const a of data ?? []) {
      const key = `${a.meter_id}:${a.user_id}`;
      sent.set(key, [...(sent.get(key) ?? []), { type: a.type as AlertType, cycleKey: a.cycle_key }]);
    }
  }

  const forecastRows = [];
  const jobs: Job[] = [];

  for (const meter of meters) {
    const meterRecharges = recharges.get(meter.id) ?? [];
    const f = forecastFor(meter, readings.get(meter.id) ?? [], meterRecharges, settings, now);
    forecastRows.push(forecastRow(meter, f, now));
    const weekly = weeklySummary(f.segments, meterRecharges, now);
    for (const to of [meter.profiles, ...(members.get(meter.id) ?? [])]) {
      // Essai terminé sans offre payée : lecture seule, plus d'alertes.
      if (accessStatus(to, now) === "expired") continue;
      const planned = planAlerts({
        now,
        meter: { id: meter.id, name: meter.name, kind: meter.kind, createdAt: meter.created_at },
        firstName: to.first_name ?? "",
        forecast: f,
        settings,
        quiet: { start: to.quiet_start, end: to.quiet_end },
        userChannels: userChannels(to),
        planChannels: (planChannels.get(effectivePlan(to, now)) ?? ["push", "email"]).filter((c) => available.includes(c)),
        sent: sent.get(`${meter.id}:${to.id}`) ?? [],
        weekly,
        weeklyEnabled: to.weekly_summary,
      });
      for (const a of planned) {
        // La relance de relevé ne concerne que celui qui peut saisir : le propriétaire.
        if (a.type === "releve" && to.id !== meter.user_id) continue;
        for (const channel of a.channels) jobs.push({ meter, to, type: a.type, cycleKey: a.cycleKey, channel, message: a.message });
      }
    }
  }

  for (let i = 0; i < forecastRows.length; i += 500) {
    const { error } = await db.from("forecasts").upsert(forecastRows.slice(i, i + 500));
    if (error) throw error;
  }

  // Abonnements push des destinataires concernés.
  const pushUsers = [...new Set(jobs.filter((j) => j.channel === "push").map((j) => j.to.id))];
  const subs = new Map<string, Recipient["push"]>();
  for (let i = 0; i < pushUsers.length; i += 100) {
    const { data, error } = await db
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .in("user_id", pushUsers.slice(i, i + 100));
    if (error) throw error;
    for (const s of data ?? []) subs.set(s.user_id, [...(subs.get(s.user_id) ?? []), s]);
  }

  // Sans appareil abonné, pas d'envoi push : réserver la ligne la marquerait
  // « non délivrée » et l'alerte ne repartirait plus une fois l'appareil abonné.
  const sendable = jobs.filter((j) => j.channel !== "push" || subs.has(j.to.id));

  let delivered = 0;
  let failed = 0;
  const gone = new Set<string>();
  for (const job of sendable) {
    // On réserve la ligne avant d'envoyer : deux exécutions qui se chevauchent
    // ne peuvent pas envoyer deux fois la même alerte (contrainte unique).
    const claim = await db
      .from("alerts")
      .upsert(
        {
          user_id: job.to.id,
          meter_id: job.meter.id,
          type: job.type,
          channel: job.channel,
          cycle_key: job.cycleKey,
          status: "sent",
          cost_fcfa: settings.unitCosts[job.channel],
          message: job.message,
          sent_at: now.toISOString(),
        },
        { onConflict: "meter_id,user_id,type,cycle_key,channel", ignoreDuplicates: true },
      )
      .select("id");
    if (claim.error) throw claim.error;
    if (!claim.data?.length) continue; // déjà pris par une autre exécution

    const result = await send(
      job.channel,
      { email: job.to.email, phone: job.to.phone, push: subs.get(job.to.id) ?? [] },
      { title: TITLES[job.type], body: job.message, url: appLink(`/app?compteur=${job.meter.id}`), tag: `${job.meter.id}:${job.type}` },
    );
    for (const id of result.gonePush ?? []) gone.add(id);
    if (result.ok) {
      delivered++;
    } else {
      failed++;
      await db.from("alerts").update({ status: "failed", cost_fcfa: 0, error: result.error?.slice(0, 500) }).eq("id", claim.data[0].id);
    }
  }

  if (gone.size) await db.from("push_subscriptions").delete().in("id", [...gone]);

  return json(req, {
    at: now.toISOString(),
    expiredPlans: expired.data,
    paymentsChecked,
    meters: meters.length,
    recipients: meters.length + [...members.values()].reduce((n, l) => n + l.length, 0),
    channels: available,
    planned: sendable.length,
    delivered,
    failed,
  });
}));
