// Mise en page de l'application. Ordinateur : barre latérale et contenu large.
// Téléphone : en-tête compact et barre d'onglets avec le bouton « Relever ».
import type { ReactNode } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useData } from "@/lib/data";
import { useInstall } from "@/lib/install";
import { R } from "@/lib/routes";
import { effectivePlanCode } from "@/lib/types";
import { Icon, type IconName } from "./icons";
import { Independence } from "./ui";

export function Logo({ className = "h-8 w-8" }: { className?: string }) {
  return <img src="/logo.svg" alt="" className={className} />;
}

export function Brand({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2 font-extrabold text-stone-900 ${className}`}>
      <Logo className="h-9 w-9" />
      <span className="text-lg">Prévi<span className="text-brand-600">Énergie</span></span>
    </span>
  );
}

const SIDE: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: R.app, label: "Tableau de bord", icon: "home", end: true },
  { to: R.releve, label: "Nouveau relevé", icon: "camera" },
  { to: R.recharge, label: "Recharge", icon: "receipt" },
  { to: R.historique, label: "Historique", icon: "chart" },
  { to: R.compteurs, label: "Mes compteurs", icon: "meter" },
  { to: R.alertes, label: "Alertes", icon: "bell" },
  { to: R.offres, label: "Offres", icon: "wallet" },
  { to: R.compte, label: "Mon compte", icon: "user" },
];

const TABS: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: R.app, label: "Accueil", icon: "home", end: true },
  { to: R.historique, label: "Historique", icon: "chart" },
  { to: R.alertes, label: "Alertes", icon: "bell" },
  { to: R.compte, label: "Compte", icon: "user" },
];

function SideLink({ to, label, icon, end }: (typeof SIDE)[number]) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
          isActive ? "bg-brand-600 text-white shadow-md shadow-brand-600/25" : "text-stone-600 hover:bg-brand-50 hover:text-brand-800"
        }`
      }
    >
      <Icon name={icon} className="h-5 w-5" />
      {label}
    </NavLink>
  );
}

function PlanCard() {
  const { profile } = useAuth();
  const { currentPlan } = useData();
  const free = effectivePlanCode(profile) === "gratuit";
  return (
    <div className="bg-hero rounded-2xl p-4 text-white">
      <p className="text-xs text-white/80">Ton offre</p>
      <p className="text-lg font-extrabold">{currentPlan?.name ?? "Gratuit"}</p>
      {free ? (
        <>
          <p className="mt-1 text-xs text-white/85">Alertes WhatsApp et SMS, plus de compteurs.</p>
          <Link to={R.offres} className="mt-3 block rounded-xl bg-white py-2 text-center text-sm font-bold text-brand-700">Passer à l'offre supérieure</Link>
        </>
      ) : (
        <Link to={R.offres} className="mt-3 block rounded-xl bg-white/20 py-2 text-center text-sm font-bold text-white ring-1 ring-white/30">Gérer mon offre</Link>
      )}
    </div>
  );
}

function InstallLink() {
  const { canPrompt, install } = useInstall();
  if (!canPrompt) return null;
  return (
    <button onClick={() => void install()} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-stone-600 hover:bg-brand-50">
      <Icon name="download" className="h-5 w-5" /> Installer l'application
    </button>
  );
}

export function AppLayout() {
  const { profile, signOut } = useAuth();
  const staff = profile?.role === "admin" || profile?.role === "support";
  return (
    <div className="min-h-dvh bg-stone-50 lg:flex">
      {/* Barre latérale (ordinateur) */}
      <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-72 lg:shrink-0 lg:flex-col lg:border-r lg:border-stone-200 lg:bg-white">
        <Link to={R.app} className="px-6 pt-6 pb-4"><Brand /></Link>
        <nav className="flex-1 space-y-1 overflow-y-auto px-4" aria-label="Navigation principale">
          {SIDE.map((s) => <SideLink key={s.to} {...s} />)}
          {staff && <SideLink to={R.admin} label="Back-office" icon="settings" />}
          <InstallLink />
        </nav>
        <div className="space-y-4 p-4">
          <PlanCard />
          <div className="flex items-center gap-3 rounded-xl px-2">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-100 font-bold text-brand-800">
              {(profile?.first_name ?? "?").slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{profile?.first_name} {profile?.last_name}</p>
              <p className="truncate text-xs text-stone-500">{profile?.email}</p>
            </div>
            <button onClick={() => void signOut()} className="rounded-lg p-2 text-stone-500 hover:bg-stone-100" aria-label="Me déconnecter" title="Me déconnecter">
              <Icon name="logout" className="h-5 w-5" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
        {/* En-tête (téléphone) */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-stone-200 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
          <Link to={R.app}><Brand /></Link>
          {staff && (
            <Link to={R.admin} className="rounded-lg px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50">Back-office</Link>
          )}
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-5 pb-32 sm:px-6 lg:px-10 lg:pt-10 lg:pb-12">
          <Outlet />
          <Independence className="mt-10" />
        </main>
      </div>

      {/* Barre d'onglets (téléphone) */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/95 pb-safe backdrop-blur lg:hidden" aria-label="Navigation principale">
        <ul className="mx-auto grid max-w-lg grid-cols-5 items-end">
          {TABS.slice(0, 2).map((t) => <Tab key={t.to} {...t} />)}
          <li className="flex justify-center">
            <Link
              to={R.releve}
              aria-label="Nouveau relevé"
              className="-mt-7 grid h-16 w-16 place-items-center rounded-full bg-brand-600 text-white shadow-xl shadow-brand-600/40 ring-4 ring-white active:bg-brand-700"
            >
              <Icon name="camera" className="h-7 w-7" />
            </Link>
          </li>
          {TABS.slice(2).map((t) => <Tab key={t.to} {...t} />)}
        </ul>
      </nav>
    </div>
  );
}

function Tab({ to, label, icon, end }: (typeof TABS)[number]) {
  return (
    <li>
      <NavLink
        to={to}
        end={end}
        className={({ isActive }) => `flex flex-col items-center gap-0.5 pt-2 pb-1 text-[11px] font-semibold ${isActive ? "text-brand-600" : "text-stone-500"}`}
      >
        <Icon name={icon} className="h-6 w-6" />
        {label}
      </NavLink>
    </li>
  );
}

/** Pages hors application : connexion, profil obligatoire, confidentialité. */
export function BareLayout({ children, aside = true }: { children: ReactNode; aside?: boolean }) {
  return (
    <div className="min-h-dvh bg-white lg:grid lg:grid-cols-2">
      {aside && (
        <div className="bg-hero relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-12 lg:text-white">
          <Link to={R.accueilPublic} className="flex items-center gap-2 text-lg font-extrabold">
            <img src="/logo.svg" alt="" className="h-10 w-10 rounded-xl ring-2 ring-white/40" /> PréviÉnergie
          </Link>
          <div>
            <p className="text-4xl leading-tight font-extrabold">Plus jamais de coupure surprise.</p>
            <ul className="mt-6 space-y-3 text-white/90">
              {["Un relevé en 10 secondes, par photo", "Les jours de courant restants, en un coup d'œil", "Prévenu à 18 h, avant la coupure"].map((t) => (
                <li key={t} className="flex items-center gap-3"><Icon name="check" className="h-5 w-5" /> {t}</li>
              ))}
            </ul>
          </div>
          <p className="text-sm text-white/75">Service indépendant, non affilié à la CIE.</p>
          <div className="absolute -right-24 -bottom-24 h-80 w-80 rounded-full bg-white/10 blur-2xl" aria-hidden />
        </div>
      )}
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-8 lg:justify-center">
        <Link to={R.accueilPublic} className={`mb-10 ${aside ? "lg:hidden" : ""}`}><Brand /></Link>
        <div className="flex-1 lg:flex-none">{children}</div>
        <Independence className={`mt-10 ${aside ? "lg:hidden" : ""}`} />
      </div>
    </div>
  );
}
