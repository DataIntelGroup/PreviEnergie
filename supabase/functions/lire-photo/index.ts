// Lecture d'une photo par l'API Claude avec vision (BF-05, BF-07) :
// écran du compteur (solde ou index) ou reçu / SMS de recharge.
// La valeur lue est toujours proposée à l'utilisateur pour confirmation.
import Anthropic from "npm:@anthropic-ai/sdk@0.135.0";
import { adminClient, env, handler, HttpError, json, readJson, requireEnv, requireUser } from "../_shared/serveur.ts";
import { accessStatus } from "../_shared/acces.ts";
import { loadSettings } from "../_shared/donnees.ts";
import { PAYMENT_METHODS } from "../_shared/validation.ts";

type Kind = "compteur" | "recu" | "facture";

interface Body {
  kind?: Kind;
  /** Image JPEG, PNG ou WebP encodée en base64, sans préfixe data:. */
  image?: string;
  mediaType?: "image/jpeg" | "image/png" | "image/webp";
  meterKind?: "prepaid" | "postpaid";
}

const MAX_BASE64 = 1_400_000; // environ 1 Mo d'image : l'application compresse sous 500 Ko
const DAILY_LIMIT = 40;

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });

const METER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["lisible", "valeur", "nature", "confiance", "remarque"],
  properties: {
    lisible: { type: "boolean" },
    valeur: nullable({ type: "number" }),
    nature: { type: "string", enum: ["credit_kwh", "index_kwh", "montant", "autre", "inconnue"] },
    confiance: { type: "number" },
    remarque: { type: "string" },
  },
};

const RECEIPT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["lisible", "kwh", "montant_fcfa", "code", "moyen_paiement", "date", "confiance", "remarque"],
  properties: {
    lisible: { type: "boolean" },
    kwh: nullable({ type: "number" }),
    montant_fcfa: nullable({ type: "number" }),
    code: nullable({ type: "string" }),
    moyen_paiement: nullable({ type: "string", enum: [...PAYMENT_METHODS] }),
    date: nullable({ type: "string", format: "date-time" }),
    confiance: { type: "number" },
    remarque: { type: "string" },
  },
};

// Facture CIE basse tension (postpayé, période de deux mois en général).
const BILL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["lisible", "periode_debut", "periode_fin", "index_ancien", "index_nouveau", "kwh", "montant_total_fcfa", "prime_fixe_ttc_fcfa", "autres_taxes_fcfa", "date_limite", "confiance", "remarque"],
  properties: {
    lisible: { type: "boolean" },
    periode_debut: nullable({ type: "string", format: "date" }),
    periode_fin: nullable({ type: "string", format: "date" }),
    index_ancien: nullable({ type: "number" }),
    index_nouveau: nullable({ type: "number" }),
    kwh: nullable({ type: "number" }),
    montant_total_fcfa: nullable({ type: "number" }),
    prime_fixe_ttc_fcfa: nullable({ type: "number" }),
    autres_taxes_fcfa: nullable({ type: "number" }),
    date_limite: nullable({ type: "string", format: "date" }),
    confiance: { type: "number" },
    remarque: { type: "string" },
  },
};

const SYSTEM = `Tu lis des photos envoyées par des abonnés de la CIE (électricité, Côte d'Ivoire) dans l'application PréviÉnergie.
Tu extrais uniquement ce qui est visible : n'invente jamais un chiffre. Si la photo est floue, coupée ou ne montre pas ce qui est demandé, mets lisible à false et explique en une phrase dans remarque, en français, en tutoyant (par exemple « Rapproche-toi de l'écran »).
confiance va de 0 à 1 et reflète ta certitude sur la valeur principale.`;

function prompt(kind: Kind, meterKind: string): string {
  if (kind === "facture") {
    return `Photo d'une facture d'électricité CIE basse tension (postpayé). Extrais :
- periode_debut et periode_fin : la « Consommation du … au … », au format AAAA-MM-JJ ;
- index_ancien et index_nouveau : colonnes ANCIEN et NOUVEAU du relevé compteur ;
- kwh : la consommation facturée en kWh (colonne DIFFERENCE ou CONSOMMATION ENREGISTREE) ;
- montant_total_fcfa : le TOTAL FACTURE ou MONTANT TOTAL A REGLER, sans les impayés antérieurs ;
- prime_fixe_ttc_fcfa : le montant TTC de la ligne « Prime fixe » ;
- autres_taxes_fcfa : la somme des « Autres taxes » (électrification rurale, enlèvement des ordures ménagères, redevance RTI, timbre) ;
- date_limite : la date limite de paiement.
N'extrais ni nom, ni adresse, ni numéro d'abonné.`;
  }
  if (kind === "compteur") {
    return meterKind === "postpaid"
      ? `Photo de l'écran d'un compteur postpayé. Donne l'index cumulé en kWh dans valeur (nature index_kwh). Ignore les chiffres rouges après la virgule s'il y en a, et les codes d'erreur.`
      : `Photo de l'écran d'un compteur prépayé (souvent Hexing, Itron, Inhemeter ou Conlog). Donne le crédit restant en kWh dans valeur (nature credit_kwh). Si l'écran affiche autre chose (date, tension, code), mets nature à autre et valeur à null.`;
  }
  return `Photo d'un reçu de recharge prépayée CIE ou capture d'un SMS de confirmation (Wave, Orange Money, MTN MoMo, Moov Money). Extrais : kwh achetés, montant_fcfa payé, code de recharge (souvent 20 chiffres, garde-le tel qu'affiché avec ses séparateurs), moyen_paiement, date et heure de l'achat au format ISO avec fuseau Z (heure d'Abidjan = UTC).`;
}

Deno.serve(handler(async (req) => {
  const user = await requireUser(req);
  const body = await readJson<Body>(req);
  const kind: Kind = body.kind === "recu" || body.kind === "facture" ? body.kind : "compteur";
  const mediaType = body.mediaType ?? "image/jpeg";
  if (!body.image || !["image/jpeg", "image/png", "image/webp"].includes(mediaType)) {
    throw new HttpError(400, "Image manquante ou format non pris en charge");
  }
  if (body.image.length > MAX_BASE64) throw new HttpError(413, "Photo trop lourde, réessaie");

  const db = adminClient();
  const { data: profile } = await db.from("profiles").select("plan_code, plan_expires_at, trial_ends_at").eq("id", user.id).maybeSingle();
  if (!profile || accessStatus(profile, new Date()) === "expired") {
    throw new HttpError(403, "Ton essai gratuit est terminé : choisis une offre pour continuer tes relevés.");
  }
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count, error: countError } = await db
    .from("ai_reads")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", since);
  if (countError) throw countError;
  if ((count ?? 0) >= DAILY_LIMIT) {
    throw new HttpError(429, "Tu as atteint la limite de lectures automatiques pour aujourd'hui. Saisis la valeur à la main.");
  }

  const settings = await loadSettings(db);
  const model = env("CLAUDE_MODEL") ?? "claude-opus-5-5";
  const client = new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });

  let parsed: Record<string, unknown> | null = null;
  let failure = "";
  try {
    const response = await client.beta.messages.create({
      model,
      max_tokens: 1024,
      betas: ["server-side-fallback-2026-07-01"],
      // Repli côté serveur si le modèle décline la requête.
      fallbacks: "default",
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: kind === "compteur" ? METER_SCHEMA : kind === "facture" ? BILL_SCHEMA : RECEIPT_SCHEMA },
      },
      system: SYSTEM,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: body.image } },
          { type: "text", text: prompt(kind, body.meterKind ?? "prepaid") },
        ],
      }],
    // deno-lint-ignore no-explicit-any
    } as any);
    if (response.stop_reason === "refusal") {
      failure = "refus";
    } else {
      const text = response.content.find((b: { type: string }) => b.type === "text") as { text: string } | undefined;
      parsed = text ? JSON.parse(text.text) : null;
      if (!parsed) failure = "réponse vide";
    }
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) failure = "limite de débit";
    else if (e instanceof Anthropic.APIConnectionError) failure = "connexion";
    else if (e instanceof Anthropic.APIError) failure = `api ${e.status}`;
    else if (e instanceof SyntaxError) failure = "json invalide";
    else throw e;
  }

  const success = !!parsed && parsed.lisible === true &&
    (kind === "compteur" ? typeof parsed.valeur === "number" : typeof parsed.kwh === "number" || typeof parsed.montant_fcfa === "number");
  const confidence = typeof parsed?.confiance === "number" ? Math.max(0, Math.min(1, parsed.confiance)) : null;

  await db.from("ai_reads").insert({
    user_id: user.id,
    kind,
    success,
    confidence,
    cost_fcfa: settings.unitCosts.aiRead,
    model,
  });

  if (!parsed) {
    console.error("lecture photo", failure);
    return json(req, { ok: false, message: "La lecture automatique n'a pas marché. Saisis la valeur à la main." });
  }
  return json(req, { ok: success, kind, result: parsed, confidence });
}));
