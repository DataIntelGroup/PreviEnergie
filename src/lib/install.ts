// Installation de la PWA. Invite native quand le navigateur en offre une
// (Chrome, Edge, Samsung Internet, Opera), guide pas à pas sinon (iPhone,
// Firefox, Safari sur Mac…), détection d'une app déjà installée.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { type InstallGuide, installGuide } from "./install-detect";
import { isStandalone } from "./push";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export interface InstallState {
  /** L'app tourne déjà installée (fenêtre à part). */
  installed: boolean;
  /** Le navigateur dit qu'elle est installée sur cet appareil (Chrome, via related_applications). */
  installedElsewhere: boolean;
  /** Installée pendant cette visite. */
  justInstalled: boolean;
  /** L'invite native est prête : un vrai bouton « Installer » est possible. */
  canPrompt: boolean;
  guide: InstallGuide;
}

let deferred: InstallPromptEvent | null = null;
let state: InstallState = {
  installed: false,
  installedElsewhere: false,
  justInstalled: false,
  canPrompt: false,
  guide: "inconnu",
};
const listeners = new Set<() => void>();

function update(patch: Partial<InstallState>) {
  state = { ...state, ...patch };
  state.canPrompt = !!deferred && !state.installed && !state.justInstalled;
  listeners.forEach((l) => l());
}

if (typeof window !== "undefined") {
  update({ installed: isStandalone(), guide: installGuide(navigator) });

  window.addEventListener("beforeinstallprompt", (e) => {
    // On garde l'invite pour la montrer au clic sur notre bouton.
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    update({ installedElsewhere: false });
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    update({ justInstalled: true });
  });
  window.matchMedia("(display-mode: standalone)").addEventListener?.("change", () => update({ installed: isStandalone() }));

  // Chrome (Android, Windows, macOS) sait dire si cette PWA est déjà
  // installée, grâce à « related_applications » du manifeste.
  const nav = navigator as Navigator & { getInstalledRelatedApps?: () => Promise<unknown[]> };
  if (!state.installed && nav.getInstalledRelatedApps) {
    nav
      .getInstalledRelatedApps()
      .then((apps) => apps.length > 0 && !deferred && update({ installedElsewhere: true }))
      .catch(() => undefined);
  }
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** Ouvre l'invite native. Sans invite disponible, ne fait rien. */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const e = deferred;
  if (!e) return "unavailable";
  await e.prompt();
  const { outcome } = await e.userChoice;
  // Une invite ne sert qu'une fois ; le navigateur en renverra une autre s'il le juge utile.
  deferred = null;
  update(outcome === "accepted" ? { justInstalled: true } : {});
  return outcome;
}

export function useInstall(): InstallState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

/** Fait apparaître les éléments `.reveal` d'un conteneur quand ils entrent à l'écran. */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const pending = () => root.querySelectorAll<HTMLElement>(".reveal:not(.is-visible)");
    if (!("IntersectionObserver" in window)) {
      pending().forEach((i) => i.classList.add("is-visible"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-visible");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    pending().forEach((i) => io.observe(i));
    // Les blocs chargés plus tard (les tarifs viennent de la base) doivent
    // aussi être suivis, sinon ils resteraient invisibles.
    const mo = new MutationObserver(() => pending().forEach((i) => io.observe(i)));
    mo.observe(root, { childList: true, subtree: true });
    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, []);
  return ref;
}
