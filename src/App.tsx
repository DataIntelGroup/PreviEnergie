// Routes : page publique sur /, application sous /app (connexion et profil
// complet obligatoires, BF-02), back-office sous /admin, chargé à part.
// Les adresses viennent toutes de lib/routes.ts.
import { lazy, type ReactNode, Suspense } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { AppLayout, BareLayout } from "@/components/Layout";
import { Button, FullPageSpinner, Notice, ToastProvider } from "@/components/ui";
import { AuthProvider, useAuth } from "@/lib/auth";
import { DataProvider } from "@/lib/data";
import { R } from "@/lib/routes";
import { isProfileComplete } from "@/lib/types";

// Chaque écran est chargé à part : la page publique reste légère.
const Accueil = lazy(() => import("@/pages/Accueil"));
const Alertes = lazy(() => import("@/pages/Alertes"));
const Compte = lazy(() => import("@/pages/Compte"));
const Compteurs = lazy(() => import("@/pages/Compteurs"));
const Confidentialite = lazy(() => import("@/pages/Confidentialite"));
const Connexion = lazy(() => import("@/pages/Connexion"));
const Historique = lazy(() => import("@/pages/Historique"));
const Landing = lazy(() => import("@/pages/Landing"));
const Offres = lazy(() => import("@/pages/Offres"));
const ProfilRequis = lazy(() => import("@/pages/ProfilRequis"));
const Recharge = lazy(() => import("@/pages/Recharge"));
const Releve = lazy(() => import("@/pages/Releve"));
const Admin = lazy(() => import("@/admin/AdminApp"));

function RequireSession({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageSpinner />;
  if (!session) {
    const suite = location.pathname === R.app ? "" : `?suite=${encodeURIComponent(location.pathname + location.search)}`;
    return <Navigate to={`${R.connexion}${suite}`} replace />;
  }
  return <>{children}</>;
}

function RequireProfile() {
  const { profile, signOut } = useAuth();
  if (!profile) {
    return (
      <BareLayout>
        <Notice tone="error">Ton profil n'a pas pu être chargé. Vérifie ta connexion internet.</Notice>
        <Button className="mt-4 w-full" onClick={() => window.location.reload()}>Réessayer</Button>
        <Button variant="ghost" className="mt-2 w-full" onClick={() => void signOut()}>Me déconnecter</Button>
      </BareLayout>
    );
  }
  if (profile.suspended) {
    return (
      <BareLayout>
        <Notice tone="error">Ton compte est suspendu. Écris à contact@previenergie.ci pour en savoir plus.</Notice>
        <Button variant="ghost" className="mt-4 w-full" onClick={() => void signOut()}>Me déconnecter</Button>
      </BareLayout>
    );
  }
  if (!isProfileComplete(profile)) return <Navigate to={R.profil} replace />;
  return (
    <DataProvider>
      <Outlet />
    </DataProvider>
  );
}

function RequireStaff({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  if (profile?.role !== "admin" && profile?.role !== "support") return <Navigate to={R.app} replace />;
  return <>{children}</>;
}

/** Visiteur : page publique. Connecté : directement son tableau de bord. */
function PublicHome() {
  const { session, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  return session ? <Navigate to={R.app} replace /> : <Landing />;
}

/** Fine barre orange en haut de l'écran à chaque changement de page. */
function RouteProgress() {
  const { pathname } = useLocation();
  return <div key={pathname} className="route-progress" aria-hidden />;
}

/** Anciennes adresses (avant /app), gardées pour les liens déjà envoyés. */
function LegacyRedirect({ to }: { to: string }) {
  const { search } = useLocation();
  return <Navigate to={`${to}${search}`} replace />;
}

const LEGACY: [string, string][] = [
  ["/releve", R.releve],
  ["/recharge", R.recharge],
  ["/historique", R.historique],
  ["/alertes", R.alertes],
  ["/compteurs", R.compteurs],
  ["/offres", R.offres],
  ["/compte", R.compte],
];

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <RouteProgress />
          <Suspense fallback={<FullPageSpinner />}>
          <Routes>
            <Route path={R.accueilPublic} element={<PublicHome />} />
            <Route path={R.connexion} element={<Connexion />} />
            <Route path={R.confidentialite} element={<BareLayout aside={false}><Confidentialite /></BareLayout>} />
            <Route path={R.profil} element={<RequireSession><ProfilRequis /></RequireSession>} />
            {LEGACY.map(([from, to]) => <Route key={from} path={from} element={<LegacyRedirect to={to} />} />)}

            <Route element={<RequireSession><RequireProfile /></RequireSession>}>
              <Route path={R.app} element={<AppLayout />}>
                <Route index element={<Accueil />} />
                <Route path="releve" element={<Releve />} />
                <Route path="recharge" element={<Recharge />} />
                <Route path="historique" element={<Historique />} />
                <Route path="alertes" element={<Alertes />} />
                <Route path="compteurs" element={<Compteurs />} />
                <Route path="offres" element={<Offres />} />
                <Route path="compte" element={<Compte />} />
                <Route path="*" element={<Navigate to={R.app} replace />} />
              </Route>
              <Route
                path={`${R.admin}/*`}
                element={
                  <RequireStaff>
                    <Suspense fallback={<FullPageSpinner />}>
                      <Admin />
                    </Suspense>
                  </RequireStaff>
                }
              />
            </Route>
            <Route path="*" element={<Navigate to={R.accueilPublic} replace />} />
          </Routes>
          </Suspense>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
