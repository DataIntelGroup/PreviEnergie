import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Service worker : hors ligne et notifications. Nouvelle version : on
// l'active au prochain retour sur l'app plutôt qu'en plein relevé.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  const update = registerSW({
    onNeedRefresh() {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") void update(true);
      }, { once: true });
    },
  });
}
