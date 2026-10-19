// Mise en page de l'application : en-tête, contenu, barre d'onglets.
import type { ReactNode } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Independence } from "./ui";

const TABS = [
  { to: "/", label: "Accueil", icon: "M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" },
  { to: "/historique", label: "Historique", icon: "M4 20V10m6 10V4m6 16v-7m4 7H2" },
  { to: "/alertes", label: "Alertes", icon: "M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9m4.3 13a1.94 1.94 0 0 0 3.4 0" },
  { to: "/compte", label: "Compte", icon: "M20 21a8 8 0 1 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10" },
];

export function Icon({ d, className = "h-6 w-6" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export function Logo({ className = "h-8 w-8" }: { className?: string }) {
  return <img src="/logo.svg" alt="" className={className} />;
}

export function AppLayout() {
  const { profile } = useAuth();
  const staff = profile?.role === "admin" || profile?.role === "support";
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col bg-stone-50">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-stone-200 bg-white/95 px-4 py-3 backdrop-blur">
        <Link to="/" className="flex items-center gap-2 font-bold text-stone-900">
          <Logo />
          <span className="text-lg">
            Prévi<span className="text-brand-600">Énergie</span>
          </span>
        </Link>
        {staff && (
          <Link to="/admin" className="rounded-lg px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50">
            Back-office
          </Link>
        )}
      </header>
      <main className="flex-1 px-4 pt-4 pb-28">
        <Outlet />
        <Independence className="mt-8" />
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-lg border-t border-stone-200 bg-white pb-safe" aria-label="Navigation principale">
        <ul className="grid grid-cols-4">
          {TABS.map((t) => (
            <li key={t.to}>
              <NavLink
                to={t.to}
                end={t.to === "/"}
                className={({ isActive }) =>
                  `flex flex-col items-center gap-0.5 pt-2 pb-1 text-xs font-medium ${isActive ? "text-brand-600" : "text-stone-500"}`
                }
              >
                <Icon d={t.icon} />
                {t.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

/** Page plein écran sans onglets (connexion, profil obligatoire). */
export function BareLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-5 py-8">
      <div className="mb-8 flex items-center gap-2 font-bold">
        <Logo className="h-10 w-10" />
        <span className="text-xl">
          Prévi<span className="text-brand-600">Énergie</span>
        </span>
      </div>
      <div className="flex-1">{children}</div>
      <Independence className="mt-8" />
    </div>
  );
}
