// Quel parcours d'installation proposer, selon le navigateur. Fonction pure
// (aucun accès à window) pour être testée sur chaque cas : tests/install.test.ts.
//
// Seuls Chrome, Edge, Samsung Internet et Opera (Android et ordinateur)
// offrent une invite native (`beforeinstallprompt`). Partout ailleurs, on
// guide vers le menu du navigateur ; on n'imite jamais un bouton natif.

export type InstallGuide =
  | "ios-safari" // Partager > Sur l'écran d'accueil
  | "ios-autre" // Chrome, Edge, Firefox sur iPhone (iOS 16.4+) : même menu Partager
  | "in-app" // navigateur intégré (Instagram, Facebook, WhatsApp…) : ouvrir dans le vrai navigateur
  | "android-chrome" // menu ⋮ > Installer l'application
  | "android-samsung" // menu ≡ > Ajouter la page à > Écran d'accueil
  | "android-firefox" // menu ⋮ > Installer / Ajouter à l'écran d'accueil
  | "android-autre"
  | "mac-safari" // Fichier > Ajouter au Dock (Safari 17, macOS Sonoma)
  | "mac-safari-ancien" // Safari 16 ou plus ancien : pas d'installation
  | "desktop-chromium" // icône d'installation dans la barre d'adresse
  | "desktop-firefox" // Firefox sur ordinateur : pas d'installation
  | "inconnu";

export interface NavigatorInfo {
  userAgent: string;
  /** navigator.maxTouchPoints : distingue un iPad (qui se dit « Macintosh ») d'un Mac. */
  maxTouchPoints: number;
}

const IN_APP = /FBAN|FBAV|FB_IAB|Instagram|WhatsApp|Snapchat|TikTok|musical_ly|BytedanceWebview|LinkedInApp|Line\/|Twitter|GSA\/|; wv\)/i;

export function isIosDevice({ userAgent, maxTouchPoints }: NavigatorInfo): boolean {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true;
  // iPadOS 13+ se présente comme un Mac, mais un Mac n'a pas d'écran tactile.
  return /Macintosh/i.test(userAgent) && maxTouchPoints > 1;
}

export function installGuide(nav: NavigatorInfo): InstallGuide {
  const ua = nav.userAgent;
  if (IN_APP.test(ua)) return "in-app";
  if (isIosDevice(nav)) {
    if (/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua)) return "ios-autre";
    return /Safari/i.test(ua) ? "ios-safari" : "in-app";
  }
  if (/Android/i.test(ua)) {
    if (/SamsungBrowser/i.test(ua)) return "android-samsung";
    if (/Firefox/i.test(ua)) return "android-firefox";
    if (/Chrome\//i.test(ua)) return "android-chrome"; // Chrome, Edge, Opera, Brave
    return "android-autre";
  }
  if (/Firefox\//i.test(ua)) return "desktop-firefox";
  if (/Chrome\/|Chromium\/|Edg\//i.test(ua)) return "desktop-chromium";
  if (/Macintosh/i.test(ua) && /Safari/i.test(ua)) {
    const v = /Version\/(\d+)/.exec(ua);
    return v && Number(v[1]) >= 17 ? "mac-safari" : "mac-safari-ancien";
  }
  return "inconnu";
}

/** Le navigateur ne permet aucune installation : on propose d'en changer. */
export const cannotInstall = (g: InstallGuide) => g === "desktop-firefox" || g === "mac-safari-ancien" || g === "inconnu";
