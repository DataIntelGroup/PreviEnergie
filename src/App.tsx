// Routes et gardes : connexion obligatoire, puis profil complet (BF-02)
// avant toute page ; back-office réservé à l'équipe, chargé à part.
import { lazy, type ReactNode, Suspense } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { AppLayout, BareLayout } from "@/components/Layout";
import { Button, FullPageSpinner, Notice, ToastProvider } from "@/components/ui";
import { AuthProvider, useAuth } from "@/lib/auth";
import { DataProvider } from "@/lib/data";
import { isProfileComplete } from "@/lib/types";
import Accueil from "@/pages/Accueil";
import Alertes from "@/pages/Alertes";
import Compte from "@/pages/Compte";
import Compteurs from "@/pages/Compteurs";
import Confidentialite from "@/pages/Confidentialite";
import Connexion from "@/pages/Connexion";
import Historique from "@/pages/Historique";
import Offres from "@/pages/Offres";
import ProfilRequis from "@/pages/ProfilRequis";
import Recharge from "@/pages/Recharge";
import Releve from "@/pages/Releve";

const Admin = lazy(() => import("@/admin/AdminApp"));

function RequireSession({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageSpinner />;
  if (!session) {
    const suite = location.pathname === "/" ? "" : `?suite=${encodeURIComponent(location.pathname + location.search)}`;
    return <Navigate to={`/connexion${suite}`} replace />;
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
  if (!isProfileComplete(profile)) return <Navigate to="/profil" replace />;
  return (
    <DataProvider>
      <Outlet />
    </DataProvider>
  );
}

function RequireStaff({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  if (profile?.role !== "admin" && profile?.role !== "support") return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/connexion" element={<Connexion />} />
            <Route path="/profil" element={<RequireSession><ProfilRequis /></RequireSession>} />
            <Route element={<RequireSession><RequireProfile /></RequireSession>}>
              <Route element={<AppLayout />}>
                <Route index element={<Accueil />} />
                <Route path="releve" element={<Releve />} />
                <Route path="recharge" element={<Recharge />} />
                <Route path="historique" element={<Historique />} />
                <Route path="alertes" element={<Alertes />} />
                <Route path="compteurs" element={<Compteurs />} />
                <Route path="offres" element={<Offres />} />
                <Route path="compte" element={<Compte />} />
                <Route path="confidentialite" element={<Confidentialite />} />
              </Route>
              <Route
                path="admin/*"
                element={
                  <RequireStaff>
                    <Suspense fallback={<FullPageSpinner />}>
                      <Admin />
                    </Suspense>
                  </RequireStaff>
                }
              />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
