// Installation de la PWA sur l'écran d'accueil : invite native sur Android
// (Chrome), guide « Partager > Sur l'écran d'accueil » sur iPhone.
import { useEffect, useRef, useState } from "react";
import { isIos, isStandalone } from "./push";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    listeners.forEach((l) => l());
  });
}

export function useInstall() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((x) => x + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  const installed = typeof window !== "undefined" && isStandalone();
  return {
    installed,
    /** Android / ordinateur : l'invite native est disponible. */
    canPrompt: !!deferred && !installed,
    /** iPhone hors application installée : il faut le guide. */
    needsIosGuide: typeof window !== "undefined" && isIos() && !installed,
    install: async () => {
      if (!deferred) return false;
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      deferred = null;
      listeners.forEach((l) => l());
      return outcome === "accepted";
    },
  };
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
