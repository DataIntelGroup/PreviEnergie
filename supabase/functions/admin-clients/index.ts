// Actions de l'équipe sur les clients (back-office, administrateurs seulement) :
//   groupes   : taille de chaque groupe de relance
//   apercu    : qui recevrait un message (un client ou un groupe), par quel canal
//   envoyer   : notification push et/ou email, à un client ou à un groupe
//   supprimer : suppression définitive d'un compte client
// Chaque envoi est enregistré dans les alertes (type « message ») et le journal.
import { appLink, configuredChannels, send } from "../_shared/canaux.ts";
import { deleteAccount } from "../_shared/compte.ts";
import { loadSettings } from "../_shared/donnees.ts";
import { inSegment, MESSAGE_LIMITS, MESSAGE_LINKS, type MessageLink, personalize, type Segment, SEGMENTS } from "../_shared/segments.ts";
import { inQuietHours, localParts } from "../_shared/temps.ts";
import { adminClient, handler, HttpError, json, readJson, requireUser } from "../_shared/serveur.ts";

type Channel = "push" | "email";
type Target = { userId: string } | { segment: Segment };

interface Body {
  action?: "groupes" | "apercu" | "envoyer" | "supprimer";
  target?: Target;
  title?: string;
  body?: string;
  link?: MessageLink;
  channels?: Channel[];
  respectQuiet?: boolean;
  userId?: string;
  confirm?: string;
}

interface Person {
  id: string;
  first_name: string | null;
  email: string | null;
  phone: string | null;
  role: string;
  suspended: boolean;
  plan_code: string;
  plan_expires_at: string | null;
  trial_ends_at: string;
  quiet_start: string;
  quiet_end: string;
  last_reading_at: string | null;
}
type Sub = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };

const COLUMNS = "id, first_name, email, phone, role, suspended, plan_code, plan_expires_at, trial_ends_at, quiet_start, quiet_end";
const MAX_RECIPIENTS = 2000;
const DAY = 86_400_000;

const db = adminClient();

async function recipients(target: Target, now: Date): Promise<Person[]> {
  if ("userId" in target) {
    const { data, error } = await db.from("profiles").select(COLUMNS).eq("id", target.userId).maybeSingle();
    if (error) throw error;
    if (!data) throw new HttpError(404, "Client introuvable");
    return [{ ...data, last_reading_at: null } as Person];
  }
  if (!(target.segment in SEGMENTS)) throw new HttpError(400, "Groupe inconnu");
  return (await allClients(now)).filter((p) => inSegment(p, target.segment, now));
}

/** Tous les clients actifs (ni équipe, ni suspendus), avec leur dernier relevé. */
async function allClients(now: Date): Promise<Person[]> {
  const { data, error } = await db.from("profiles").select(COLUMNS).eq("role", "user").eq("suspended", false).limit(10_000);
  if (error) throw error;
  // Dernier relevé de chacun, sur 30 jours (au-delà : inactif de toute façon).
  const last = new Map<string, string>();
  for (let from = 0; ; from += 1000) {
    const { data: rows, error: e } = await db.from("readings").select("user_id, taken_at")
      .gte("taken_at", new Date(now.getTime() - 30 * DAY).toISOString()).order("taken_at", { ascending: false }).range(from, from + 999);
    if (e) throw e;
    for (const r of rows ?? []) if (!last.has(r.user_id)) last.set(r.user_id, r.taken_at);
    if (!rows || rows.length < 1000) break;
  }
  return (data as Omit<Person, "last_reading_at">[]).map((p) => ({ ...p, last_reading_at: last.get(p.id) ?? null }));
}

async function subscriptions(ids: string[]): Promise<Map<string, Sub[]>> {
  const out = new Map<string, Sub[]>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db.from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth").in("user_id", ids.slice(i, i + 200));
    if (error) throw error;
    for (const s of data ?? []) out.set(s.user_id, [...(out.get(s.user_id) ?? []), s]);
  }
  return out;
}

const quietNow = (p: Person, now: Date) => inQuietHours(localParts(now).minutes, p.quiet_start, p.quiet_end);

/** Exécute fn sur chaque élément, 8 à la fois. */
async function eachLimited<T>(items: T[], fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(8, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

Deno.serve(handler(async (req) => {
  const user = await requireUser(req);
  const { data: me } = await db.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") throw new HttpError(403, "Réservé aux administrateurs");

  const b = await readJson<Body>(req);
  const now = new Date();
  const available = configuredChannels().filter((c): c is Channel => c === "push" || c === "email");

  // ------------------------------------------------------------ suppression
  if (b.action === "supprimer") {
    if (!b.userId) throw new HttpError(400, "Client manquant");
    if (b.userId === user.id) throw new HttpError(400, "Tu ne peux pas supprimer ton propre compte d'ici");
    const { data: target } = await db.from("profiles").select("email, role, first_name, last_name").eq("id", b.userId).maybeSingle();
    if (!target) throw new HttpError(404, "Client introuvable");
    if (target.role !== "user") throw new HttpError(400, "Retire d'abord son rôle d'équipe avant de supprimer ce compte");
    if (!target.email || (b.confirm ?? "").trim().toLowerCase() !== target.email.toLowerCase()) {
      throw new HttpError(400, "Recopie exactement l'email du client pour confirmer");
    }
    await deleteAccount(db, b.userId, user.id, { by: "admin", email: target.email, name: `${target.first_name ?? ""} ${target.last_name ?? ""}`.trim() });
    return json(req, { ok: true });
  }

  // ------------------------------------------------------------ taille de chaque groupe
  if (b.action === "groupes") {
    const all = await allClients(now);
    const subs = await subscriptions(all.map((p) => p.id));
    const counts = Object.fromEntries((Object.keys(SEGMENTS) as Segment[]).map((s) => {
      const members = all.filter((p) => inSegment(p, s, now));
      return [s, { recipients: members.length, withPush: members.filter((p) => subs.has(p.id)).length }];
    }));
    return json(req, { counts, available });
  }

  if (!b.target) throw new HttpError(400, "Destinataire manquant");
  const people = await recipients(b.target, now);
  if (people.length > MAX_RECIPIENTS) throw new HttpError(400, `Groupe trop grand (${people.length}) : ${MAX_RECIPIENTS} au plus par envoi`);
  const subs = await subscriptions(people.map((p) => p.id));
  const respectQuiet = b.respectQuiet ?? "segment" in b.target;

  // ------------------------------------------------------------ aperçu
  if (b.action === "apercu") {
    return json(req, {
      recipients: people.length,
      withPush: people.filter((p) => subs.has(p.id)).length,
      withEmail: people.filter((p) => p.email).length,
      quietNow: people.filter((p) => quietNow(p, now)).length,
      available,
      sample: people.slice(0, 5).map((p) => p.first_name ?? p.email),
    });
  }

  // ------------------------------------------------------------ envoi
  if (b.action !== "envoyer") throw new HttpError(400, "Action inconnue");
  const title = (b.title ?? "").trim();
  const body = (b.body ?? "").trim();
  if (!title || title.length > MESSAGE_LIMITS.title) throw new HttpError(400, `Titre obligatoire, ${MESSAGE_LIMITS.title} caractères au plus`);
  if (!body || body.length > MESSAGE_LIMITS.body) throw new HttpError(400, `Message obligatoire, ${MESSAGE_LIMITS.body} caractères au plus`);
  const link = b.link && b.link in MESSAGE_LINKS ? b.link : "/app";
  const channels = (b.channels ?? []).filter((c) => available.includes(c));
  if (channels.length === 0) {
    throw new HttpError(503, (b.channels ?? []).includes("email") && !available.includes("email")
      ? "L'email n'est pas encore configuré (EMAIL_API_KEY et EMAIL_FROM)."
      : "Choisis au moins un canal disponible.");
  }

  const settings = await loadSettings(db);
  const campaign = crypto.randomUUID();
  const stats = { recipients: people.length, quiet: 0, push: { sent: 0, failed: 0, noDevice: 0 }, email: { sent: 0, failed: 0, noAddress: 0 } };
  const logs: Record<string, unknown>[] = [];
  const gone: string[] = [];

  await eachLimited(people, async (p) => {
    if (respectQuiet && quietNow(p, now)) {
      stats.quiet++;
      return;
    }
    const text = personalize(body, p.first_name);
    for (const channel of channels) {
      const mySubs = subs.get(p.id) ?? [];
      if (channel === "push" && mySubs.length === 0) {
        stats.push.noDevice++;
        continue;
      }
      if (channel === "email" && !p.email) {
        stats.email.noAddress++;
        continue;
      }
      const r = await send(channel, { email: p.email, phone: p.phone, push: mySubs }, { title: personalize(title, p.first_name), body: text, url: appLink(link), tag: `message-${campaign}` });
      if (r.gonePush?.length) gone.push(...r.gonePush);
      if (r.ok) stats[channel].sent++;
      else stats[channel].failed++;
      logs.push({
        user_id: p.id, meter_id: null, type: "message", channel, cycle_key: campaign, status: r.ok ? "sent" : "failed",
        cost_fcfa: r.ok ? settings.unitCosts[channel] : 0, message: text, error: r.error?.slice(0, 500) ?? null,
      });
    }
  });

  for (let i = 0; i < logs.length; i += 500) await db.from("alerts").insert(logs.slice(i, i + 500));
  if (gone.length) await db.from("push_subscriptions").delete().in("id", gone);
  await db.from("audit_log").insert({
    actor_id: user.id, action: "message.send",
    target_type: "segment" in b.target ? "segment" : "profile",
    target_id: "segment" in b.target ? b.target.segment : b.target.userId,
    details: { title, link, channels, ...stats },
  });
  return json(req, stats);
}));
