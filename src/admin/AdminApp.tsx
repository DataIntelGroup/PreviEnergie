// Back-office (BF-26 à BF-32), chargé à part pour alléger l'application.
// Le rôle support voit tout en lecture seule ; seul l'admin modifie.
import { createContext, useContext, useEffect, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes } from "react-router-dom";
import { Logo } from "@/components/Layout";
import { ToastProvider } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import Dashboards, { type Dashboard } from "./Dashboards";
import Journal from "./Journal";
import Reglages from "./Reglages";
import Utilisateurs from "./Utilisateurs";
import { R } from "@/lib/routes";

interface AdminState {
  days: number;
  setDays: (d: number) => void;
  data: Dashboard | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  isAdmin: boolean;
}

const AdminContext = createContext<AdminState | null>(null);
export const useAdmin = () => {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("useAdmin hors du back-office");
  return ctx;
};

const NAV = [
  { to: "/admin/inscriptions", label: "Inscriptions" },
  { to: "/admin/finances", label: "Finances" },
  { to: "/admin/couts", label: "Coûts et marge" },
  { to: "/admin/activite", label: "Activité" },
  { to: "/admin/utilisateurs", label: "Utilisateurs" },
  { to: "/admin/reglages", label: "Réglages" },
  { to: "/admin/journal", label: "Journal" },
];

export default function AdminApp() {
  const { profile } = useAuth();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    supabase.rpc("admin_dashboard", { p_days: days }).then(({ data, error }) => {
      if (!active) return;
      setLoading(false);
      if (error) setError(error.message);
      else {
        setError(null);
        setData(data as Dashboard);
      }
    });
    return () => {
      active = false;
    };
  }, [days, tick]);

  // « Temps réel » : rafraîchissement automatique chaque minute.
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const value: AdminState = { days, setDays, data, loading, error, reload: () => setTick((x) => x + 1), isAdmin: profile?.role === "admin" };

  return (
    <AdminContext.Provider value={value}>
      <ToastProvider>
        <div className="min-h-dvh bg-stone-50 lg:flex">
          <aside className="border-b border-stone-200 bg-white lg:sticky lg:top-0 lg:h-dvh lg:w-60 lg:shrink-0 lg:border-r lg:border-b-0">
            <div className="flex items-center justify-between px-4 py-3 lg:block">
              <Link to={R.admin} className="flex items-center gap-2 font-bold">
                <Logo className="h-7 w-7" />
                <span>Back-office</span>
              </Link>
              <Link to={R.app} className="text-sm font-medium text-brand-700 lg:mt-2 lg:block">← Retour à l'app</Link>
            </div>
            <nav className="flex gap-1 overflow-x-auto px-2 pb-2 lg:flex-col lg:px-3" aria-label="Back-office">
              {NAV.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  className={({ isActive }) =>
                    `shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition active:scale-95 ${isActive ? "bg-brand-50 text-brand-700" : "text-stone-600 hover:bg-stone-100"}`
                  }
                >
                  {n.label}
                </NavLink>
              ))}
            </nav>
            <p className="hidden px-4 py-3 text-xs text-stone-500 lg:block">
              Connecté en {profile?.role === "admin" ? "administrateur" : "support (lecture seule)"}
            </p>
          </aside>
          <main className="min-w-0 flex-1 p-4 lg:p-8">
            <Routes>
              <Route index element={<Navigate to="inscriptions" replace />} />
              <Route path="inscriptions" element={<Dashboards view="signups" />} />
              <Route path="finances" element={<Dashboards view="finance" />} />
              <Route path="couts" element={<Dashboards view="costs" />} />
              <Route path="activite" element={<Dashboards view="activity" />} />
              <Route path="utilisateurs" element={<Utilisateurs />} />
              <Route path="reglages" element={<Reglages />} />
              <Route path="journal" element={<Journal />} />
              <Route path="*" element={<Navigate to="inscriptions" replace />} />
            </Routes>
          </main>
        </div>
      </ToastProvider>
    </AdminContext.Provider>
  );
}
