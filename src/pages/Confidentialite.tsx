// Information sur le traitement des données personnelles (ARTCI). Page publique.
import { Link, useNavigate } from "react-router-dom";
import { R } from "@/lib/routes";

export default function Confidentialite() {
  const navigate = useNavigate();
  const back = () => (window.history.length > 1 ? navigate(-1) : navigate(R.accueilPublic));
  return (
    <div className="space-y-4 text-stone-700">
      <h1 className="text-2xl font-extrabold text-stone-900">Confidentialité</h1>
      <div className="space-y-3 text-sm leading-relaxed">
        <p>
          PréviÉnergie est édité par Data Intelligence Group (DIG), Côte d'Ivoire. C'est un service indépendant, non affilié à la CIE :
          nous n'avons pas accès à ton compte CIE, toutes les données viennent de toi.
        </p>
        <p><strong>Ce que nous gardons :</strong> ton email, ton prénom, ton nom, ton téléphone, ta commune si tu la donnes, tes compteurs, relevés, recharges (codes compris), les photos que tu envoies et les alertes envoyées.</p>
        <p><strong>Pourquoi :</strong> calculer ta consommation, prévoir la coupure et te prévenir sur les canaux que tu choisis. Les photos sont lues automatiquement par un service d'intelligence artificielle (Anthropic) uniquement pour en extraire les chiffres.</p>
        <p><strong>WhatsApp et SMS :</strong> uniquement si tu les actives, avec ton accord explicite, que tu peux retirer à tout moment dans Alertes.</p>
        <p><strong>Tes droits :</strong> tu peux télécharger toutes tes données et supprimer ton compte depuis Mon compte. La suppression efface aussi tes photos. Les paiements restent enregistrés sans ton nom, pour la comptabilité.</p>
        <p>Le traitement fait l'objet d'une déclaration auprès de l'ARTCI. Pour toute question : <a href="mailto:contact@previenergie.ci" className="font-medium text-brand-700">contact@previenergie.ci</a>.</p>
      </div>
      <div className="flex gap-4 pt-2">
        <button onClick={back} className="font-semibold text-brand-700">← Retour</button>
        <Link to={R.accueilPublic} className="font-semibold text-stone-500">Accueil</Link>
      </div>
    </div>
  );
}
