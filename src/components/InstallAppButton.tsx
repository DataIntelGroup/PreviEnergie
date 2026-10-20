// Bouton d'installation de la PWA. Trois cas, jamais de faux bouton :
// - le navigateur offre une invite native : « Installer l'application » l'ouvre ;
// - sinon : « Comment installer » ouvre le guide pas à pas de ce navigateur ;
// - déjà installée (ou installée à l'instant) : un simple badge.
import { type ReactNode, useState } from "react";
import { cannotInstall, type InstallGuide } from "@/lib/install-detect";
import { promptInstall, useInstall } from "@/lib/install";
import { R } from "@/lib/routes";
import { Icon, type IconName } from "./icons";
import { Sheet } from "./ui";

type Step = { icon: IconName; text: ReactNode };
interface GuideContent {
  title: string;
  steps: Step[];
  note?: string;
  /** Proposer de copier le lien pour l'ouvrir dans un autre navigateur. */
  copy?: boolean;
}

const b = (t: string) => <strong className="font-semibold text-stone-900">{t}</strong>;

const IOS_STEPS: Step[] = [
  { icon: "share", text: <>Touche le bouton {b("Partager")} de Safari (sur les iOS récents, il est dans le menu {b("⋯")}).</> },
  { icon: "addSquare", text: <>Fais défiler et choisis {b("Sur l'écran d'accueil")}.</> },
  { icon: "check", text: <>Touche {b("Ajouter")} : PréviÉnergie rejoint tes apps.</> },
];

const GUIDES: Record<InstallGuide, GuideContent> = {
  "ios-safari": {
    title: "Sur iPhone et iPad (Safari)",
    steps: IOS_STEPS,
    note: "Les alertes par notification marchent à partir d'iOS 16.4, une fois l'app ajoutée à l'écran d'accueil.",
  },
  "ios-autre": {
    title: "Sur iPhone (Chrome, Edge, Firefox)",
    steps: [
      { icon: "share", text: <>Touche le bouton {b("Partager")} dans la barre d'adresse.</> },
      { icon: "addSquare", text: <>Choisis {b("Sur l'écran d'accueil")}, puis {b("Ajouter")}.</> },
    ],
    note: "Il faut iOS 16.4 ou plus. Si l'option n'apparaît pas, ouvre ce site dans Safari.",
    copy: true,
  },
  "in-app": {
    title: "Ouvre d'abord le site dans ton navigateur",
    steps: [
      { icon: "dots", text: <>Tu es dans le navigateur d'une application (WhatsApp, Facebook, Instagram…), qui ne sait pas installer. Touche {b("⋯")} puis {b("Ouvrir dans le navigateur")}.</> },
      { icon: "copy", text: <>Ou copie le lien et colle-le dans {b("Safari")} (iPhone) ou {b("Chrome")} (Android).</> },
    ],
    copy: true,
  },
  "android-chrome": {
    title: "Sur Android (Chrome)",
    steps: [
      { icon: "dots", text: <>Touche le menu {b("⋮")} en haut à droite.</> },
      { icon: "download", text: <>Choisis {b("Installer l'application")} (ou {b("Ajouter à l'écran d'accueil")}, puis {b("Installer")}).</> },
      { icon: "check", text: <>PréviÉnergie apparaît dans tes applications.</> },
    ],
  },
  "android-samsung": {
    title: "Sur Samsung Internet",
    steps: [
      { icon: "menu", text: <>Touche le menu {b("≡")} en bas de l'écran.</> },
      { icon: "addSquare", text: <>Choisis {b("Ajouter la page à")}, puis {b("Écran d'accueil")}.</> },
      { icon: "check", text: <>Touche {b("Ajouter")}.</> },
    ],
  },
  "android-firefox": {
    title: "Sur Android (Firefox)",
    steps: [
      { icon: "dots", text: <>Touche le menu {b("⋮")}.</> },
      { icon: "addSquare", text: <>Choisis {b("Ajouter à l'écran d'accueil")} (ou {b("Installer")}), puis confirme.</> },
    ],
    note: "Pour la meilleure expérience, notamment les notifications, utilise plutôt Chrome.",
  },
  "android-autre": {
    title: "Sur Android",
    steps: [
      { icon: "copy", text: <>Ce navigateur ne propose pas l'installation. Ouvre ce site dans {b("Chrome")}.</> },
      { icon: "dots", text: <>Puis menu {b("⋮")} › {b("Installer l'application")}.</> },
    ],
    copy: true,
  },
  "desktop-chromium": {
    title: "Sur ordinateur (Chrome ou Edge)",
    steps: [
      { icon: "monitor", text: <>Clique l'icône d'installation à droite de la barre d'adresse.</> },
      { icon: "dots", text: <>Ou ouvre le menu {b("⋮")} (Chrome) ou {b("…")} (Edge) et cherche {b("Installer PréviÉnergie")} : dans {b("Caster, enregistrer et partager")} sur Chrome, dans {b("Applications")} sur Edge.</> },
      { icon: "check", text: <>PréviÉnergie s'ouvre dans sa propre fenêtre et rejoint le menu Démarrer ou le Launchpad.</> },
    ],
  },
  "mac-safari": {
    title: "Sur Mac (Safari)",
    steps: [
      { icon: "share", text: <>Menu {b("Fichier")} › {b("Ajouter au Dock")} (ou bouton {b("Partager")} › {b("Ajouter au Dock")}).</> },
      { icon: "check", text: <>Clique {b("Ajouter")} : l'app s'ouvre depuis le Dock, dans sa fenêtre.</> },
    ],
    note: "Il faut macOS Sonoma (14) ou plus récent.",
  },
  "mac-safari-ancien": {
    title: "Sur Mac",
    steps: [{ icon: "monitor", text: <>Cette version de Safari n'installe pas les apps web. Mets à jour macOS (Sonoma ou plus), ou ouvre ce site dans {b("Chrome")} ou {b("Edge")}.</> }],
    copy: true,
  },
  "desktop-firefox": {
    title: "Sur ordinateur (Firefox)",
    steps: [{ icon: "monitor", text: <>Firefox n'installe pas encore les apps web sur ordinateur. Ouvre ce site dans {b("Chrome")} ou {b("Edge")} pour l'installer. Tu peux aussi l'utiliser tel quel, en favori.</> }],
    copy: true,
  },
  inconnu: {
    title: "Installer PréviÉnergie",
    steps: [{ icon: "copy", text: <>Ouvre ce site dans {b("Safari")} sur iPhone, {b("Chrome")} sur Android, {b("Chrome")} ou {b("Edge")} sur ordinateur, puis suis le guide.</> }],
    copy: true,
  },
};

/** Les autres appareils, pour installer ailleurs que sur celui-ci. */
const OTHERS: { guide: InstallGuide; label: string }[] = [
  { guide: "ios-safari", label: "iPhone" },
  { guide: "android-chrome", label: "Android" },
  { guide: "desktop-chromium", label: "Ordinateur" },
  { guide: "mac-safari", label: "Mac (Safari)" },
];

export function InstallGuidePanel({ initial }: { initial: InstallGuide }) {
  const [guide, setGuide] = useState(initial);
  const [copied, setCopied] = useState(false);
  const g = GUIDES[guide];
  const url = `${window.location.origin}${R.accueilPublic}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt("Copie ce lien :", url);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Appareil">
        {OTHERS.map((o) => {
          const active = guide === o.guide || (o.guide === "ios-safari" && guide === "ios-autre");
          return (
            <button
              key={o.guide}
              role="tab"
              aria-selected={active}
              onClick={() => setGuide(o.guide === "ios-safari" && initial === "ios-autre" ? "ios-autre" : o.guide)}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold transition active:scale-95 ${active ? "bg-brand-600 text-white shadow-md shadow-brand-600/25" : "bg-brand-50 text-brand-800 ring-1 ring-brand-100 hover:ring-brand-300"}`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      <div>
        <p className="font-bold text-stone-900">
          {g.title}
          {guide === initial && <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">cet appareil</span>}
        </p>
        <ol className="mt-4 space-y-3">
          {g.steps.map((s, i) => (
            <li key={i} className="flex gap-3.5 rounded-2xl bg-[#fffaf5] p-3.5 ring-1 ring-brand-100">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-brand-600 shadow-sm ring-1 ring-brand-100">
                <Icon name={s.icon} className="h-5 w-5" strokeWidth={s.icon === "dots" ? 3.5 : 2} />
              </span>
              <span className="self-center text-[15px] leading-snug text-stone-600">
                <span className="mr-1.5 font-bold text-brand-600">{i + 1}.</span>
                {s.text}
              </span>
            </li>
          ))}
        </ol>
        {g.note && <p className="mt-3 text-sm text-stone-500">{g.note}</p>}
      </div>
      {g.copy && (
        <button
          onClick={() => void copy()}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-white py-3 font-semibold text-stone-800 ring-1 ring-stone-200 transition hover:ring-brand-300 active:scale-[0.98]"
        >
          <Icon name={copied ? "check" : "copy"} className="h-5 w-5 text-brand-600" />
          {copied ? "Lien copié" : "Copier le lien du site"}
        </button>
      )}
    </div>
  );
}

export function InstallAppButton({ variant = "solid", className = "" }: { variant?: "solid" | "link"; className?: string }) {
  const s = useInstall();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (s.installed) return null; // on est déjà dans l'app installée

  if (s.justInstalled || s.installedElsewhere) {
    return (
      <p role="status" className={`inline-flex items-center gap-2.5 rounded-2xl bg-emerald-50 px-4 py-2.5 text-[15px] font-semibold text-emerald-800 ring-1 ring-emerald-200 ${className}`}>
        <span className="grid h-6 w-6 place-items-center rounded-full bg-emerald-500 text-white"><Icon name="check" className="h-3.5 w-3.5" strokeWidth={3} /></span>
        {s.justInstalled ? "PréviÉnergie est installée : retrouve-la parmi tes apps." : "Déjà installée sur cet appareil : ouvre-la depuis tes apps."}
      </p>
    );
  }

  const native = s.canPrompt;
  const label = native ? "Installer l'application" : cannotInstall(s.guide) ? "Installer sur un autre navigateur" : "Comment installer l'application";
  const onClick = async () => {
    if (!native) return setOpen(true);
    setBusy(true);
    try {
      await promptInstall();
    } finally {
      setBusy(false);
    }
  };

  const styles =
    variant === "solid"
      ? "rounded-2xl bg-brand-600 px-6 py-3.5 text-base font-bold text-white shadow-xl shadow-brand-600/30 hover:-translate-y-0.5 hover:bg-brand-700 active:translate-y-0"
      : "font-bold text-brand-700 hover:text-brand-800";

  return (
    <>
      <button
        onClick={() => void onClick()}
        disabled={busy}
        aria-haspopup={native ? undefined : "dialog"}
        data-install={native ? "native" : "guide"}
        className={`inline-flex items-center justify-center gap-2.5 text-[15px] transition active:scale-[0.97] disabled:opacity-60 ${styles} ${className}`}
      >
        <Icon name={native ? "download" : "phone"} className="h-5 w-5" /> {label}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Installer PréviÉnergie">
        <InstallGuidePanel initial={s.guide} />
      </Sheet>
    </>
  );
}
