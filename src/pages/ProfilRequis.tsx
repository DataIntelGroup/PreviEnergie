// Étape obligatoire avant tout accès à l'application (BF-02).
import { Navigate, useNavigate } from "react-router-dom";
import { BareLayout } from "@/components/Layout";
import { ProfileForm } from "@/components/ProfileForm";
import { useAuth } from "@/lib/auth";
import { isProfileComplete } from "@/lib/types";

export default function ProfilRequis() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  if (!profile) return null;
  if (isProfileComplete(profile)) return <Navigate to="/" replace />;
  return (
    <BareLayout>
      <h1 className="text-2xl font-bold">Faisons connaissance</h1>
      <p className="mt-2 mb-6 text-stone-600">Ces informations sont nécessaires pour utiliser PréviÉnergie. Tu pourras les modifier à tout moment.</p>
      <ProfileForm profile={profile} submitLabel="Continuer" onSaved={() => navigate("/compteurs?premier=1", { replace: true })} />
      <button onClick={() => void signOut()} className="mt-6 w-full text-center text-sm font-medium text-stone-500">
        Me déconnecter
      </button>
    </BareLayout>
  );
}
