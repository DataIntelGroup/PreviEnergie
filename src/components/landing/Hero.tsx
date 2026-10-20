// En-tête et héros de la page publique, d'après la maquette validée :
// texte à gauche, téléphone lumineux à droite entouré de notifications.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Gauge } from "@/components/Gauge";
import { Icon } from "@/components/icons";
import { Logo } from "@/components/Layout";
import { InstallAppButton } from "@/components/InstallAppButton";
import { R } from "@/lib/routes";

export interface NavItem {
  href: string;
  label: string;
}

/** Section visible à l'écran, pour souligner le bon lien du menu. */
function useActiveSection(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (!("IntersectionObserver" in window)) return;
    const visible = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) visible.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0);
        const best = [...visible.entries()].sort((a, b) => b[1] - a[1])[0];
        setActive(best && best[1] > 0 ? best[0] : null);
      },
      { rootMargin: "-30% 0px -50% 0px", threshold: [0, 0.1, 0.3, 0.6] },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [ids.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  return active;
}

/** Défilement vers une section, puis un bref halo pour montrer où l'on arrive. */
export function goToSection(href: string) {
  const el = document.getElementById(href.replace("#", ""));
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  history.replaceState(null, "", href);
  el.classList.remove("section-flash");
  void el.offsetWidth; // relance l'animation
  el.classList.add("section-flash");
}

export function LandingHeader({ nav }: { nav: NavItem[] }) {
  const [menu, setMenu] = useState(false);
  const active = useActiveSection(nav.map((n) => n.href.slice(1)));
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const link = (n: NavItem, mobile = false) => {
    const on = active === n.href.slice(1);
    return (
      <a
        key={n.href}
        href={n.href}
        aria-current={on ? "true" : undefined}
        onClick={(e) => {
          e.preventDefault();
          setMenu(false);
          goToSection(n.href);
        }}
        className={
          mobile
            ? `rounded-xl px-3 py-3 font-semibold transition active:scale-[0.98] ${on ? "bg-brand-50 text-brand-700" : "text-stone-700"}`
            : `relative py-2 text-[15px] font-medium transition active:scale-95 ${on ? "text-brand-700" : "text-stone-600 hover:text-stone-900"}`
        }
      >
        {n.label}
        {!mobile && (
          <span
            aria-hidden
            className={`absolute -bottom-0.5 left-0 h-0.5 rounded-full bg-brand-600 transition-all duration-300 ${on ? "w-full opacity-100" : "w-0 opacity-0"}`}
          />
        )}
      </a>
    );
  };

  return (
    <header className={`sticky top-0 z-40 transition-colors ${scrolled ? "border-b border-brand-100/70 bg-white/80 backdrop-blur-xl" : "bg-transparent"}`}>
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3.5">
        <Link to={R.accueilPublic} className="flex items-center gap-2.5 font-extrabold transition active:scale-95" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
          <Logo className="h-11 w-11" />
          <span className="text-2xl tracking-tight">Prévi<span className="text-brand-600">Énergie</span></span>
        </Link>
        <nav className="hidden items-center gap-10 md:flex" aria-label="Sections">{nav.map((n) => link(n))}</nav>
        <div className="hidden items-center gap-3 md:flex">
          <Link to={R.connexion} className="rounded-full px-4 py-2 text-[15px] font-semibold text-stone-800 transition hover:bg-white active:scale-95">Se connecter</Link>
          <Link
            to={R.connexion}
            className="inline-flex items-center gap-2 rounded-full bg-brand-600 px-5 py-2.5 text-[15px] font-semibold text-white shadow-lg shadow-brand-600/30 transition hover:bg-brand-700 active:scale-95"
          >
            Commencer gratuitement <Icon name="arrowRight" className="h-4 w-4" />
          </Link>
        </div>
        <button className="rounded-xl p-2 transition active:scale-90 md:hidden" onClick={() => setMenu((m) => !m)} aria-label="Menu" aria-expanded={menu}>
          <Icon name={menu ? "x" : "menu"} className="h-6 w-6" />
        </button>
      </div>
      {menu && (
        <div className="animate-fade-up border-t border-brand-100 bg-white px-5 py-4 md:hidden">
          <nav className="flex flex-col gap-1" aria-label="Sections">{nav.map((n) => link(n, true))}</nav>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Link to={R.connexion} className="rounded-xl py-3 text-center font-semibold ring-1 ring-stone-200 active:scale-[0.98]">Se connecter</Link>
            <Link to={R.connexion} className="rounded-xl bg-brand-600 py-3 text-center font-semibold text-white active:scale-[0.98]">Commencer</Link>
          </div>
        </div>
      )}
    </header>
  );
}

/** Petits traits d'éclat, comme un dessin à la main. */
function Spark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" aria-hidden>
      <path d="M8 6l7 9M4 22h11M20 3l1 10" />
    </svg>
  );
}

function Phone() {
  return (
    <div className="relative w-[17.5rem] sm:w-[19.5rem]">
      {/* Cadre */}
      <div className="relative rounded-[3rem] bg-stone-900 p-[10px] shadow-[0_40px_80px_-20px_rgba(124,45,18,0.45)] ring-1 ring-stone-700">
        <div className="relative overflow-hidden rounded-[2.4rem] bg-[#fbf7f3]">
          {/* Barre d'état */}
          <div className="flex items-center justify-between px-6 pt-3 text-[11px] font-semibold text-stone-800">
            <span>9:41</span>
            <span className="absolute left-1/2 top-2.5 h-6 w-24 -translate-x-1/2 rounded-full bg-stone-900" aria-hidden />
            <span className="flex items-center gap-1" aria-hidden>
              <svg viewBox="0 0 18 12" className="h-2.5 w-4" fill="currentColor"><rect x="0" y="8" width="3" height="4" rx="1" /><rect x="5" y="5" width="3" height="7" rx="1" /><rect x="10" y="2" width="3" height="10" rx="1" /><rect x="15" y="0" width="3" height="12" rx="1" /></svg>
              <svg viewBox="0 0 26 12" className="h-2.5 w-5"><rect x="0.5" y="0.5" width="22" height="11" rx="3" fill="none" stroke="currentColor" /><rect x="2" y="2" width="16" height="8" rx="2" fill="currentColor" /><rect x="23.5" y="4" width="2" height="4" rx="1" fill="currentColor" /></svg>
            </span>
          </div>
          <div className="px-4 pt-6 pb-3">
            {/* Carte orange */}
            <div className="bg-hero rounded-[1.6rem] p-4 text-white shadow-lg shadow-brand-700/30">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold">Maison</span>
                <span className="rounded-full bg-white/20 px-2.5 py-1 text-[10px] font-medium">Pense à recharger</span>
              </div>
              <div className="mt-2">
                <Gauge days={4.2} level="amber" label="Exemple : 4 jours restants" onColor size="sm" max={9} />
              </div>
              <p className="mt-2 text-center text-[11px] text-white/80">Coupure probable</p>
              <p className="text-center text-sm font-bold">vendredi vers 20 h</p>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              {[
                ["Moyenne", "5,0 kWh/j"],
                ["Coût / jour", "550 FCFA"],
              ].map(([l, v]) => (
                <div key={l} className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-stone-200/70">
                  <p className="text-[10px] text-stone-500">{l}</p>
                  <p className="text-sm font-extrabold">{v}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-2xl bg-brand-600 py-3 text-center text-sm font-bold text-white shadow-md shadow-brand-600/30">Relever</div>
          </div>
          {/* Onglets */}
          <div className="grid grid-cols-4 border-t border-stone-200 bg-white px-2 pt-2 pb-4 text-[9px] font-medium text-stone-500">
            {[
              ["home", "Accueil"],
              ["history", "Historique"],
              ["bell", "Notifications"],
              ["user", "Profil"],
            ].map(([icon, label], i) => (
              <span key={label} className={`flex flex-col items-center gap-0.5 ${i === 0 ? "text-brand-600" : ""}`}>
                <Icon name={icon as "home"} className="h-4 w-4" />
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Hero({ onHowItWorks }: { onHowItWorks: () => void }) {
  return (
    <section className="relative overflow-hidden">
      {/* Fond : halo pêche derrière le téléphone */}
      <div className="pointer-events-none absolute -top-40 right-[-10%] h-[44rem] w-[44rem] rounded-full bg-[radial-gradient(circle,rgba(251,146,60,0.35),rgba(253,186,116,0.15)_45%,transparent_70%)]" aria-hidden />
      <div className="relative mx-auto grid max-w-7xl items-center gap-16 px-5 pt-10 pb-20 lg:grid-cols-[1.15fr_0.85fr] lg:pt-16 lg:pb-28">
        {/* Texte */}
        <div className="animate-fade-up relative lg:pl-10">
          <Spark className="absolute -top-2 -left-1 hidden h-12 w-12 -rotate-12 text-brand-500 lg:block" />
          <span className="inline-flex items-center gap-2 rounded-full bg-brand-100/70 px-3.5 py-1.5 text-sm font-medium text-brand-800">
            <span className="h-2 w-2 rounded-full bg-emerald-500" /> Pour les abonnés CIE, prépayé et postpayé
          </span>
          <h1 className="mt-6 text-[2.75rem] leading-[1.02] font-extrabold tracking-tight text-stone-900 sm:text-6xl xl:text-[4.25rem]">
            Plus jamais de
            <br />
            <span className="text-brand-600 sm:whitespace-nowrap">coupure surprise</span>.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-stone-600 sm:text-xl">
            Un relevé de ton compteur en 10 secondes, et PréviÉnergie te dit combien de jours de courant il te reste. Tu es prévenu à 18 h, quand tu peux encore recharger.
          </p>
          <div className="mt-9 flex flex-col gap-4 sm:flex-row">
            <Link
              to={R.connexion}
              className="inline-flex items-center justify-center gap-2.5 rounded-2xl bg-brand-600 px-7 py-4 text-lg font-bold whitespace-nowrap text-white shadow-xl shadow-brand-600/30 transition hover:-translate-y-0.5 hover:bg-brand-700 active:translate-y-0 active:scale-[0.98]"
            >
              Commencer gratuitement <Icon name="arrowRight" className="h-5 w-5" />
            </Link>
            <button
              onClick={onHowItWorks}
              className="inline-flex items-center justify-center gap-2.5 rounded-2xl bg-white px-7 py-4 text-lg font-bold whitespace-nowrap text-stone-800 shadow-lg shadow-stone-900/5 ring-1 ring-stone-200 transition hover:ring-brand-300 active:scale-[0.98]"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden><path d="M7 4.5v15l12-7.5z" /></svg>
              Voir comment ça marche
            </button>
          </div>
          <ul className="mt-8 flex flex-wrap gap-x-7 gap-y-3 text-[15px] text-stone-600">
            {["14 jours gratuits", "Sans mot de passe", "Sans engagement"].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-400 text-white"><Icon name="check" className="h-3 w-3" strokeWidth={3} /></span>
                {t}
              </li>
            ))}
          </ul>
          <div className="mt-8"><InstallAppButton variant="link" /></div>
        </div>

        {/* Visuel */}
        <div className="animate-fade-up relative mx-auto flex justify-center lg:justify-self-center" style={{ animationDelay: "120ms" }}>
          {/* Halo et anneau lumineux autour du téléphone */}
          <div className="pointer-events-none absolute top-1/2 left-1/2 h-[34rem] w-[34rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(249,115,22,0.35),transparent_62%)] blur-2xl" aria-hidden />
          <svg viewBox="0 0 600 600" className="pointer-events-none absolute top-1/2 left-1/2 h-[36rem] w-[36rem] -translate-x-1/2 -translate-y-1/2" aria-hidden>
            <defs>
              <linearGradient id="anneau" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#fb923c" stopOpacity="0" />
                <stop offset="0.45" stopColor="#fdba74" stopOpacity="0.95" />
                <stop offset="1" stopColor="#ea580c" stopOpacity="0" />
              </linearGradient>
              <filter id="lueur" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="3" result="b" />
                <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>
            <g filter="url(#lueur)" fill="none" strokeLinecap="round">
              <path d="M95 410 C 60 300, 160 170, 330 150" stroke="url(#anneau)" strokeWidth="4" />
              <path d="M140 470 C 300 560, 520 470, 530 300" stroke="url(#anneau)" strokeWidth="3" />
            </g>
          </svg>

          <div className="relative">
            <Phone />

            {/* Notification d'alerte */}
            <div className="animate-float absolute -top-10 -left-28 hidden w-64 rounded-2xl bg-white p-3.5 shadow-2xl shadow-stone-900/10 ring-1 ring-stone-200/70 sm:block">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-600 text-white"><Icon name="bolt" className="h-4 w-4" /></span>
                <div className="min-w-0">
                  <p className="flex justify-between gap-2 text-sm font-bold">PréviÉnergie <span className="text-xs font-medium text-stone-400">16:00</span></p>
                  <p className="text-[13px] leading-snug text-stone-600">Plus que 2 jours de courant sur « Maison ». Recharge avant jeudi.</p>
                </div>
              </div>
            </div>

            {/* Recharge enregistrée */}
            <div className="animate-float-slow absolute -right-28 bottom-[4.5rem] hidden w-72 rounded-2xl bg-white p-3.5 shadow-2xl shadow-stone-900/10 ring-1 ring-stone-200/70 sm:block">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-500 text-white"><Icon name="check" className="h-4 w-4" strokeWidth={3} /></span>
                <div className="min-w-0 flex-1">
                  <p className="flex justify-between gap-2 text-sm font-bold">Recharge enregistrée <span className="text-xs font-medium text-stone-400">12:45</span></p>
                  <p className="text-[13px] text-stone-600">+36 kWh · Wave · 4 000 FCFA</p>
                </div>
              </div>
            </div>

            {/* Tuiles d'icônes */}
            <span className="animate-float-slow absolute top-[42%] -right-16 hidden h-14 w-14 place-items-center rounded-2xl bg-white text-brand-600 shadow-xl shadow-stone-900/10 ring-1 ring-stone-200/70 sm:grid">
              <Icon name="bolt" className="h-7 w-7" />
            </span>
            <span className="animate-float absolute bottom-16 -left-16 hidden h-14 w-14 place-items-center rounded-2xl bg-white text-brand-600 shadow-xl shadow-stone-900/10 ring-1 ring-stone-200/70 sm:grid">
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="currentColor" aria-hidden><rect x="4" y="11" width="4" height="9" rx="1.5" /><rect x="10" y="6" width="4" height="14" rx="1.5" /><rect x="16" y="13" width="4" height="7" rx="1.5" /></svg>
            </span>

            {/* Annotation manuscrite */}
            <div className="absolute -top-12 -right-40 hidden rotate-[-10deg] text-brand-600 xl:block" style={{ fontFamily: "Caveat, cursive" }}>
              <Spark className="absolute -top-6 -left-8 h-8 w-8 rotate-12 text-brand-500" />
              <p className="text-[2rem] leading-[0.95] font-bold">Ton énergie,<br />&nbsp;&nbsp;sous contrôle !</p>
              <svg viewBox="0 0 160 30" className="mt-1 ml-6 h-6 w-36" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
                <path d="M4 22 C 50 8, 100 6, 156 14" />
              </svg>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
