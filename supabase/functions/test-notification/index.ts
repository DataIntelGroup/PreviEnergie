// Envoi d'une notification de test sur un canal, depuis l'écran des alertes,
// pour que l'utilisateur vérifie qu'il la reçoit bien. Limité à 5 par jour.
import { appLink, configuredChannels, send } from "../_shared/canaux.ts";
import { loadSettings } from "../_shared/donnees.ts";
import type { Channel } from "../_shared/reglages.ts";
import { adminClient, handler, HttpError, json, readJson, requireUser } from "../_shared/serveur.ts";

Deno.serve(handler(async (req) => {
  const user = await requireUser(req);
  const { channel } = await readJson<{ channel?: Channel }>(req);
  if (!channel || !["push", "email", "whatsapp", "sms"].includes(channel)) throw new HttpError(400, "Canal inconnu");
  if (!configuredChannels().includes(channel)) throw new HttpError(503, "Ce canal n'est pas encore ouvert");

  const db = adminClient();
  const [{ data: profile }, settings] = await Promise.all([
    db.from("profiles").select("first_name, email, phone, plan_code, plan_expires_at").eq("id", user.id).single(),
    loadSettings(db),
  ]);
  if (!profile) throw new HttpError(404, "Profil introuvable");
  const paid = profile.plan_code !== "gratuit" && (!profile.plan_expires_at || new Date(profile.plan_expires_at) > new Date());
  if ((channel === "whatsapp" || channel === "sms") && !paid) throw new HttpError(403, "Canal réservé aux offres payantes");

  const today = new Date().toISOString().slice(0, 10);
  const { count } = await db.from("alerts").select("id", { count: "exact", head: true })
    .eq("user_id", user.id).eq("type", "test").gte("sent_at", `${today}T00:00:00Z`);
  if ((count ?? 0) >= 5) throw new HttpError(429, "Tu as déjà fait 5 essais aujourd'hui");

  const { data: subs } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", user.id);
  const message = `Bonjour ${profile.first_name ?? ""}, c'est un essai : tes alertes PréviÉnergie arriveront comme ceci.`;
  const result = await send(channel, { email: profile.email, phone: profile.phone, push: subs ?? [] }, {
    title: "Notification de test",
    body: message,
    url: appLink("/app/alertes"),
    tag: "test",
  });
  await db.from("alerts").insert({
    user_id: user.id,
    meter_id: null,
    type: "test",
    channel,
    cycle_key: crypto.randomUUID(),
    status: result.ok ? "sent" : "failed",
    cost_fcfa: result.ok ? settings.unitCosts[channel] : 0,
    message,
    error: result.error?.slice(0, 500) ?? null,
  });
  if (result.gonePush?.length) await db.from("push_subscriptions").delete().in("id", result.gonePush);
  if (!result.ok) throw new HttpError(502, channel === "push" ? "Notification non reçue : réactive les notifications sur cet appareil." : "Envoi impossible pour le moment.");
  return json(req, { ok: true });
}));
