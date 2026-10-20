import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { R } from "./lib/routes";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Service worker : hors ligne et notifications. Nouvelle version : on
// l'active au prochain retour sur l'app plutôt qu'en plein relevé.
// Pages où l'on quitte l'app en pleine saisie (appareil photo, choix d'un fichier, SMS).
const SAISIES: string[] = [R.releve, R.recharge, R.compteurs, R.connexion];

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  const update = registerSW({
    onNeedRefresh() {
      // Jamais pendant une saisie : on quitte souvent l'app au milieu d'un
      // formulaire (copier le code de recharge, lire le code de connexion).
      const apply = () => {
        if (document.visibilityState !== "hidden" || document.querySelector("form, [role=dialog]") || SAISIES.some((p) => location.pathname.startsWith(p))) return;
        document.removeEventListener("visibilitychange", apply);
        void update(true);
      };
      document.addEventListener("visibilitychange", apply);
    },
    // Une app installée peut rester ouverte des jours : on demande une
    // nouvelle version toutes les heures, et à chaque retour sur l'app.
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      const check = () => {
        if (navigator.onLine && !reg.installing) void reg.update().catch(() => undefined);
      };
      setInterval(check, 60 * 60 * 1000);
      document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && check());
    },
  });
}

// Après une mise en ligne, un onglet resté ouvert peut demander un morceau
// de l'ancienne version, qui n'existe plus : on recharge la page une fois.
window.addEventListener("vite:preloadError", (event) => {
  try {
    const last = Number(sessionStorage.getItem("rechargement-version") ?? 0);
    if (Date.now() - last < 60_000) return; // pas de boucle
    sessionStorage.setItem("rechargement-version", String(Date.now()));
  } catch {
    // stockage indisponible : on recharge quand même
  }
  event.preventDefault();
  window.location.reload();
});
