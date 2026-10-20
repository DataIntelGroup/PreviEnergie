// Bandeau d'essai gratuit (14 jours) et de lecture seule une fois l'essai terminé.
import { Link } from "react-router-dom";
import { useData } from "@/lib/data";
import { fcfa } from "@/lib/format";
import { R } from "@/lib/routes";
import { Icon } from "./icons";

export function AccessBanner() {
  const { subscription, plans } = useData();
  const cheapest = plans.filter((p) => p.active && p.price_fcfa > 0).sort((a, b) => a.price_fcfa - b.price_fcfa)[0];
  const from = cheapest ? `${cheapest.name} à ${fcfa(cheapest.price_fcfa)} par mois` : "une offre";

  if (subscription.status === "paid") return null;

  if (subscription.status === "trial") {
    const d = subscription.trialDaysLeft ?? 0;
    return (
      <div className="flex flex-col gap-3 rounded-2xl bg-brand-50 p-4 ring-1 ring-brand-200 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-600 text-white"><Icon name="sparkles" className="h-5 w-5" /></span>
          <p className="text-sm text-brand-900">
            <strong>Essai gratuit : encore {d} jour{d > 1 ? "s" : ""}.</strong> Ensuite, {from} pour garder tes relevés et tes alertes.
          </p>
        </div>
        <Link to={R.offres} className="shrink-0 rounded-xl bg-brand-600 px-4 py-2 text-center text-sm font-bold text-white hover:bg-brand-700">Voir les offres</Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-stone-900 p-5 text-white sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-500"><Icon name="lock" className="h-5 w-5" /></span>
        <p className="text-sm">
          <strong>Ton essai gratuit est terminé.</strong> Ton compte est en lecture seule : ton historique reste visible, mais plus de relevés ni d'alertes. Reprends dès {from}.
        </p>
      </div>
      <Link to={R.offres} className="shrink-0 rounded-xl bg-white px-4 py-2 text-center text-sm font-bold text-stone-900">Choisir une offre</Link>
    </div>
  );
}
