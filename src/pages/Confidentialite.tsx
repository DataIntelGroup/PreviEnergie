// Information sur le traitement des données personnelles (ARTCI).
import { Link } from "react-router-dom";
import { Card, PageTitle } from "@/components/ui";

export default function Confidentialite() {
  return (
    <div className="space-y-4 text-stone-700">
      <PageTitle>Confidentialité</PageTitle>
      <Card className="space-y-3 text-sm leading-relaxed">
        <p>
          PréviÉnergie est édité par Data Intelligence Group (DIG), Côte d'Ivoire. C'est un service indépendant, non affilié à la CIE :
          nous n'avons pas accès à ton compte CIE, toutes les données viennent de toi.
        </p>
        <p><strong>Ce que nous gardons :</strong> ton email, ton prénom, ton nom, ton téléphone, ta commune si tu la donnes, tes compteurs, relevés, recharges (codes compris), les photos que tu envoies et les alertes envoyées.</p>
        <p><strong>Pourquoi :</strong> calculer ta consommation, prévoir la coupure et te prévenir sur les canaux que tu choisis. Les photos sont lues automatiquement par un service d'intelligence artificielle (Anthropic) uniquement pour en extraire les chiffres.</p>
        <p><strong>WhatsApp et SMS :</strong> uniquement si tu les actives, avec ton accord explicite, que tu peux retirer à tout moment dans Alertes.</p>
        <p><strong>Tes droits :</strong> tu peux télécharger toutes tes données et supprimer ton compte depuis Mon compte. La suppression efface aussi tes photos. Les paiements restent enregistrés sans ton nom, pour la comptabilité.</p>
        <p>Le traitement fait l'objet d'une déclaration auprès de l'ARTCI. Pour toute question : contact@previenergie.ci.</p>
      </Card>
      <Link to="/compte" className="block text-center font-medium text-brand-700">Retour</Link>
    </div>
  );
}
