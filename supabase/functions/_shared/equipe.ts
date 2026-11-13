// Prévenir l'équipe (administrateurs) d'une demande à traiter : paiement à
// vérifier, mot de passe oublié. Notification sur leurs appareils, et email
// si l'envoi d'emails est configuré. Réservé au serveur.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import { appLink, configuredChannels, send } from "./canaux.ts";

export async function notifyAdmins(db: SupabaseClient, title: string, body: string, path: string, tag: string): Promise<void> {
  try {
    const { data: admins } = await db.from("profiles").select("id, email, phone").eq("role", "admin");
    if (!admins?.length) return;
    const { data: subs } = await db.from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth").in("user_id", admins.map((a) => a.id));
    const channels = configuredChannels();
    const msg = { title, body, url: appLink(path), tag };
    const gone: string[] = [];
    await Promise.all(admins.map(async (a) => {
      const push = (subs ?? []).filter((s) => s.user_id === a.id);
      if (channels.includes("push") && push.length) {
        const r = await send("push", { email: a.email, phone: a.phone, push }, msg);
        gone.push(...(r.gonePush ?? []));
      }
      if (channels.includes("email") && a.email) await send("email", { email: a.email, phone: a.phone, push: [] }, msg);
    }));
    if (gone.length) await db.from("push_subscriptions").delete().in("id", gone);
  } catch (e) {
    // La demande est enregistrée même si la notification échoue.
    console.error("notifyAdmins", e);
  }
}

/** Notification au client (paiement validé ou refusé), sur ses appareils. */
export async function notifyUser(db: SupabaseClient, userId: string, title: string, body: string, path: string, tag: string): Promise<void> {
  try {
    if (!configuredChannels().includes("push")) return;
    const { data: push } = await db.from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth").eq("user_id", userId);
    if (!push?.length) return;
    const r = await send("push", { email: null, phone: null, push }, { title, body, url: appLink(path), tag });
    if (r.gonePush?.length) await db.from("push_subscriptions").delete().in("id", r.gonePush);
  } catch (e) {
    console.error("notifyUser", e);
  }
}
