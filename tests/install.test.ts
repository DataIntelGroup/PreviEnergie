import { describe, expect, it } from "vitest";
import { cannotInstall, installGuide, isIosDevice } from "../src/lib/install-detect";

// Agents utilisateurs réels (raccourcis aux parties utiles).
const UA = {
  iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.7204.119 Mobile/15E148 Safari/604.1",
  iphoneFirefox: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/141.0 Mobile/15E148 Safari/605.1.15",
  iphoneInstagram: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 390.0.0.27.81",
  iphoneFacebook: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/520.0.0.38.101]",
  iphoneWebview: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  ipadDesktop: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
  androidChrome: "Mozilla/5.0 (Linux; Android 14; SM-A156B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36",
  androidSamsung: "Mozilla/5.0 (Linux; Android 14; SM-A156B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36",
  androidFirefox: "Mozilla/5.0 (Android 14; Mobile; rv:141.0) Gecko/141.0 Firefox/141.0",
  androidWhatsApp: "Mozilla/5.0 (Linux; Android 14; SM-A156B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/139.0.0.0 Mobile Safari/537.36",
  windowsEdge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0",
  windowsChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
  windowsFirefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:141.0) Gecko/20100101 Firefox/141.0",
  macSafari17: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
  macSafari16: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15",
  macChrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
};

const guide = (userAgent: string, maxTouchPoints = 0) => installGuide({ userAgent, maxTouchPoints });

describe("parcours d'installation selon le navigateur", () => {
  it("iPhone : Safari, autres navigateurs, navigateurs intégrés", () => {
    expect(guide(UA.iphoneSafari, 5)).toBe("ios-safari");
    expect(guide(UA.iphoneChrome, 5)).toBe("ios-autre");
    expect(guide(UA.iphoneFirefox, 5)).toBe("ios-autre");
    expect(guide(UA.iphoneInstagram, 5)).toBe("in-app");
    expect(guide(UA.iphoneFacebook, 5)).toBe("in-app");
    expect(guide(UA.iphoneWebview, 5)).toBe("in-app");
  });

  it("un iPad qui se présente comme un Mac reste un iPad", () => {
    expect(isIosDevice({ userAgent: UA.ipadDesktop, maxTouchPoints: 5 })).toBe(true);
    expect(guide(UA.ipadDesktop, 5)).toBe("ios-safari");
    expect(isIosDevice({ userAgent: UA.macSafari17, maxTouchPoints: 0 })).toBe(false);
  });

  it("Android : Chrome, Samsung Internet, Firefox, vue intégrée", () => {
    expect(guide(UA.androidChrome, 5)).toBe("android-chrome");
    expect(guide(UA.androidSamsung, 5)).toBe("android-samsung");
    expect(guide(UA.androidFirefox, 5)).toBe("android-firefox");
    expect(guide(UA.androidWhatsApp, 5)).toBe("in-app");
  });

  it("ordinateur : Chrome et Edge installent, Firefox non", () => {
    expect(guide(UA.windowsEdge)).toBe("desktop-chromium");
    expect(guide(UA.windowsChrome)).toBe("desktop-chromium");
    expect(guide(UA.macChrome)).toBe("desktop-chromium");
    expect(guide(UA.windowsFirefox)).toBe("desktop-firefox");
    expect(cannotInstall("desktop-firefox")).toBe(true);
  });

  it("Mac : Safari 17 ajoute au Dock, Safari 16 ne sait pas", () => {
    expect(guide(UA.macSafari17)).toBe("mac-safari");
    expect(guide(UA.macSafari16)).toBe("mac-safari-ancien");
    expect(cannotInstall("mac-safari-ancien")).toBe(true);
    expect(cannotInstall("mac-safari")).toBe(false);
  });

  it("navigateur inconnu : on ne promet rien", () => {
    expect(guide("Lynx/2.9")).toBe("inconnu");
    expect(cannotInstall("inconnu")).toBe(true);
  });
});
