/// <reference lib="webworker" />
// Service worker : mise en cache de l'application (hors ligne) et
// réception des notifications push (BF-19).
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] };

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// Ce qui est mis en cache : uniquement les fichiers de l'application (JS,
// CSS, HTML, icônes) de la version en cours, remplacés à chaque mise en
// ligne. Jamais les données : les appels à Supabase passent toujours par le
// réseau, on ne peut donc pas afficher un solde ou un relevé périmé.

// Navigation : le réseau d'abord (la page la plus récente), et hors ligne la
// page de l'application mise en cache. « / » et « /index.html » sont déjà
// servis par le précache ci-dessus.
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  const { pathname } = new URL(event.request.url);
  if (pathname === "/" || pathname === "/index.html") return;
  event.respondWith(
    fetch(event.request).catch(async () => (await caches.match("/index.html")) ?? Response.error()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
});

interface PushPayload {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
}

self.addEventListener("push", (event) => {
  let data: PushPayload = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title ?? "PréviÉnergie", {
      body: data.body ?? "",
      icon: "/pwa-192x192.png",
      badge: "/pwa-64x64.png",
      tag: data.tag,
      data: { url: data.url ?? "/" },
      lang: "fr",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data as { url?: string })?.url ?? "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of clients) {
        if (new URL(c.url).origin === self.location.origin) {
          await c.focus();
          if ("navigate" in c) await (c as WindowClient).navigate(target);
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
