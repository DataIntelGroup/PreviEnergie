// Abonnement aux notifications Web Push. Sur iPhone, il faut iOS 16.4 ou
// plus et l'application ajoutée à l'écran d'accueil.
import { isIosDevice } from "./install-detect";
import { supabase } from "./supabase";

const VAPID = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export type PushState = "unsupported" | "ios-install" | "denied" | "off" | "on" | "unconfigured";

export const isIos = () => isIosDevice(navigator);
/** L'app tourne-t-elle installée (fenêtre à part, sans barre d'adresse) ? */
export const isStandalone = () =>
  ["standalone", "minimal-ui", "fullscreen", "window-controls-overlay"].some((m) => window.matchMedia(`(display-mode: ${m})`).matches) ||
  (navigator as { standalone?: boolean }).standalone === true;

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function pushState(): Promise<PushState> {
  if (!VAPID) return "unconfigured";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return isIos() && !isStandalone() ? "ios-install" : "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  // En développement, le service worker n'est pas enregistré.
  if (import.meta.env.DEV) return "unsupported";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? "on" : "off";
}

export async function enablePush(): Promise<void> {
  if (!VAPID) throw new Error("Notifications pas encore configurées");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Tu as refusé les notifications. Autorise-les dans les réglages du navigateur.");
  const reg = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Service de notifications indisponible, recharge la page.")), 10_000)),
  ]);
  const sub = (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID) }));
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  // Un même appareil peut changer de compte : la fonction reprend la ligne.
  const { error } = await supabase.rpc("register_push", {
    p_endpoint: json.endpoint,
    p_p256dh: json.keys.p256dh,
    p_auth: json.keys.auth,
    p_user_agent: navigator.userAgent,
  });
  if (error) throw error;
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  await sub.unsubscribe();
}
