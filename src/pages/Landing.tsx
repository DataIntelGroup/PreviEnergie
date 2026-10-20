// Page d'accueil publique : présenter PréviÉnergie et donner envie de
// commencer. Les tarifs viennent de la base (offres actives).
import { CHANNEL_LABELS } from "@shared/reglages.ts";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Gauge } from "@/components/Gauge";
import { Icon, type IconName } from "@/components/icons";
import { Logo } from "@/components/Layout";
import { fcfa } from "@/lib/format";
import { useInstall, useReveal } from "@/lib/install";
import { R } from "@/lib/routes";
import { supabase } from "@/lib/supabase";
import type { Plan } from "@/lib/types";

const NAV = [
  { href: "#fonctionnement", label: "Comment ça marche" },
  { href: "#fonctionnalites", label: "Fonctionnalités" },
  { href: "#tarifs", label: "Tarifs" },
  { href: "#questions", label: "Questions" },
];

const STEPS: { icon: IconName; title: string; text: string }[] = [
  { icon: "camera", title: "Photographie ton compteur", text: "Une photo de l'écran suffit. La valeur est lue automatiquement, tu confirmes en un geste." },
  { icon: "trend", title: "On apprend ta consommation", text: "Après 3 relevés sur 2 jours, PréviÉnergie calcule ta moyenne par jour, recharges déduites." },
  { icon: "bell", title: "Tu es prévenu avant la coupure", text: "À 18 h, quand tu peux encore recharger : 5 jours avant, 2 jours avant et la veille." },
];

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: "clock", title: "Jours de courant restants", text: "Une jauge claire et la date probable de coupure, avec une marge de sécurité pour ne jamais être surpris." },
  { icon: "bell", title: "Alertes sur tes canaux", text: "Notification sur ton téléphone et email, gratuitement. WhatsApp et SMS avec les offres payantes." },
  { icon: "sparkles", title: "Lecture automatique", text: "Photo de l'écran, du reçu ou du SMS de recharge : les chiffres sont lus pour toi, tu vérifies." },
  { icon: "receipt", title: "Recharges et codes gardés", text: "Wave, Orange Money, MTN MoMo, Moov Money : tout ton historique au même endroit, codes compris." },
  { icon: "chart", title: "Dépenses sous contrôle", text: "Consommation par jour, coût par jour et dépenses du mois, pour savoir combien recharger." },
  { icon: "users", title: "Partage avec tes proches", text: "Famille à l'étranger, colocataire : partage le suivi d'un compteur. Chacun le voit depuis son compte et reçoit les alertes." },
  { icon: "history", title: "Bilan de la semaine", text: "Chaque semaine : ta consommation, l'évolution par rapport à la semaine d'avant et tes recharges." },
  { icon: "layers", title: "Plusieurs compteurs", text: "Maison, boutique, logement des parents : suis tous tes compteurs, prépayés ou postpayés. Jusqu'à 50 avec l'offre Entreprise." },
];

const FAQ = [
  {
    q: "PréviÉnergie est-il lié à la CIE ?",
    a: "Non. PréviÉnergie est un service indépendant, non affilié à la CIE. Nous n'avons pas accès à ton compte CIE : toutes les données viennent des relevés et recharges que tu enregistres.",
  },
  {
    q: "Comment la date de coupure est-elle calculée ?",
    a: "À partir de tes relevés, on calcule ta consommation réelle entre deux relevés (recharges déduites), puis une moyenne qui donne plus de poids aux jours récents. On ajoute 20 % de marge : l'alerte part un peu tôt plutôt qu'un peu tard.",
  },
  {
    q: "Combien de relevés faut-il faire ?",
    a: "Pendant les premiers jours, un relevé par jour. Ensuite, un relevé tous les deux jours suffit pour garder une prévision juste. Si tu oublies, on te le rappelle à 19 h.",
  },
  {
    q: "Ça marche sur iPhone ?",
    a: "Oui. Ouvre PréviÉnergie dans Safari, touche Partager puis « Sur l'écran d'accueil ». Les notifications fonctionnent à partir d'iOS 16.4, une fois l'application installée.",
  },
  {
    q: "Et si j'ai un compteur postpayé ?",
    a: "Ajoute ta dernière facture CIE, en photo ou à la main : on en tire ta période de facturation, la part fixe et le vrai prix du kWh, taxes comprises. Avec tes relevés d'index, PréviÉnergie estime ta prochaine facture avant de la recevoir.",
  },
  {
    q: "Comment payer une offre ?",
    a: "Par Wave, Orange Money, MTN MoMo ou Moov Money, via CinetPay. Les offres sont mensuelles et sans engagement : sans renouvellement, tu reviens simplement à l'offre gratuite.",
  },
];

function PhoneMockup() {
  return (
    <div className="relative mx-auto w-[17.5rem] sm:w-[19rem]">
      <div className="absolute -inset-8 rounded-[3rem] bg-brand-400/30 blur-3xl" aria-hidden />
      <div className="relative rounded-[2.6rem] border-[10px] border-stone-900 bg-stone-50 shadow-2xl shadow-brand-900/30">
        <div className="absolute top-2 left-1/2 h-5 w-24 -translate-x-1/2 rounded-full bg-stone-900" aria-hidden />
        <div className="overflow-hidden rounded-[2rem] px-3 pt-9 pb-4">
          <p className="px-1 text-xs text-stone-500">Bonjour Awa 👋</p>
          <div className="bg-hero mt-2 rounded-3xl p-4 text-white shadow-lg">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold">Maison</span>
              <span className="rounded-full bg-white/20 px-2 py-0.5">Pense à recharger</span>
            </div>
            <div className="mt-3">
              <Gauge days={4.2} level="amber" label="Exemple : 4 jours restants" onColor size="sm" max={14} />
            </div>
            <p className="mt-3 text-center text-[11px] text-white/80">Coupure probable</p>
            <p className="text-center text-sm font-bold">vendredi vers 20 h</p>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {[
              ["Moyenne", "5,0 kWh/j"],
              ["Coût / jour", "550 FCFA"],
            ].map(([l, v]) => (
              <div key={l} className="rounded-2xl bg-white p-2.5 ring-1 ring-stone-200">
                <p className="text-[10px] text-stone-500">{l}</p>
                <p className="text-sm font-bold">{v}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <span className="flex-1 rounded-xl bg-brand-600 py-2 text-center text-xs font-bold text-white">Relever</span>
            <span className="flex-1 rounded-xl bg-white py-2 text-center text-xs font-bold text-brand-700 ring-1 ring-brand-200">Recharge</span>
          </div>
        </div>
      </div>
      {/* Notifications flottantes */}
      <div className="animate-float absolute -top-6 -left-24 hidden w-56 rounded-2xl bg-white p-3 shadow-xl ring-1 ring-stone-200 sm:block">
        <div className="flex items-start gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-brand-600 text-white"><Icon name="bolt" className="h-4 w-4" /></span>
          <div>
            <p className="text-xs font-bold">18:00 · PréviÉnergie</p>
            <p className="text-xs text-stone-600">Plus que 2 jours de courant sur « Maison ». Recharge avant jeudi.</p>
          </div>
        </div>
      </div>
      <div className="animate-float-slow absolute -right-4 -bottom-6 hidden w-52 rounded-2xl bg-white p-3 shadow-xl ring-1 ring-stone-200 sm:block">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-emerald-500 text-white"><Icon name="check" className="h-4 w-4" /></span>
          <div>
            <p className="text-xs font-bold">Recharge enregistrée</p>
            <p className="text-xs text-stone-600">+36 kWh · Wave · 4 000 FCFA</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function InstallButton() {
  const { canPrompt, needsIosGuide, install, installed } = useInstall();
  const [guide, setGuide] = useState(false);
  if (installed) return null;
  if (canPrompt) {
    return (
      <button onClick={() => void install()} className="inline-flex items-center gap-2 text-sm font-semibold text-brand-800 hover:text-brand-900">
        <Icon name="download" className="h-4 w-4" /> Installer l'application
      </button>
    );
  }
  if (!needsIosGuide) return null;
  return (
    <div className="text-sm">
      <button onClick={() => setGuide((g) => !g)} className="inline-flex items-center gap-2 font-semibold text-brand-800">
        <Icon name="download" className="h-4 w-4" /> Installer sur iPhone
      </button>
      {guide && <p className="mt-2 max-w-sm text-stone-600">Dans Safari, touche Partager puis « Sur l'écran d'accueil ».</p>}
    </div>
  );
}

export default function Landing() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [menu, setMenu] = useState(false);
  const page = useReveal<HTMLDivElement>();

  useEffect(() => {
    supabase.from("plans").select("*").eq("active", true).order("sort")
      .then(({ data }) => setPlans((data as Plan[]) ?? []));
  }, []);

  return (
    <div ref={page} className="bg-aurora min-h-dvh text-stone-900">
      {/* En-tête */}
      <header className="sticky top-0 z-40 border-b border-brand-100/60 bg-white/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <Link to={R.accueilPublic} className="flex items-center gap-2 font-extrabold">
            <Logo className="h-9 w-9" />
            <span className="text-lg">Prévi<span className="text-brand-600">Énergie</span></span>
          </Link>
          <nav className="hidden items-center gap-7 text-sm font-medium text-stone-600 md:flex" aria-label="Sections">
            {NAV.map((n) => <a key={n.href} href={n.href} className="hover:text-brand-700">{n.label}</a>)}
          </nav>
          <div className="hidden items-center gap-2 md:flex">
            <Link to={R.connexion} className="rounded-xl px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-white">Se connecter</Link>
            <Link to={R.connexion} className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-brand-600/25 hover:bg-brand-700">
              Commencer gratuitement
            </Link>
          </div>
          <button className="rounded-xl p-2 md:hidden" onClick={() => setMenu((m) => !m)} aria-label="Menu" aria-expanded={menu}>
            <Icon name={menu ? "x" : "menu"} className="h-6 w-6" />
          </button>
        </div>
        {menu && (
          <div className="animate-fade-up border-t border-brand-100 bg-white px-5 py-4 md:hidden">
            <nav className="flex flex-col gap-1" aria-label="Sections">
              {NAV.map((n) => (
                <a key={n.href} href={n.href} onClick={() => setMenu(false)} className="rounded-lg px-2 py-2.5 font-medium text-stone-700">{n.label}</a>
              ))}
            </nav>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Link to={R.connexion} className="rounded-xl py-3 text-center font-semibold ring-1 ring-stone-200">Se connecter</Link>
              <Link to={R.connexion} className="rounded-xl bg-brand-600 py-3 text-center font-semibold text-white">Commencer</Link>
            </div>
          </div>
        )}
      </header>

      {/* Héros */}
      <section className="relative overflow-hidden">
        <div className="bg-grid absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" aria-hidden />
        <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-5 pt-14 pb-20 lg:grid-cols-[1.1fr_0.9fr] lg:pt-20 lg:pb-28">
          <div className="animate-fade-up">
            <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-brand-800 ring-1 ring-brand-200">
              <span className="h-2 w-2 rounded-full bg-emerald-500" /> Pour les abonnés CIE, prépayé et postpayé
            </span>
            <h1 className="mt-5 text-4xl leading-[1.05] font-extrabold tracking-tight sm:text-5xl lg:text-6xl">
              Plus jamais de <span className="bg-gradient-to-r from-brand-500 to-brand-700 bg-clip-text text-transparent">coupure surprise</span>.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-stone-600">
              Un relevé de ton compteur en 10 secondes, et PréviÉnergie te dit combien de jours de courant il te reste. Tu es prévenu à 18 h, quand tu peux encore recharger.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to={R.connexion} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-brand-600 px-7 py-4 text-base font-bold text-white shadow-xl shadow-brand-600/30 transition hover:-translate-y-0.5 hover:bg-brand-700">
                Commencer gratuitement <Icon name="arrowRight" className="h-5 w-5" />
              </Link>
              <a href="#fonctionnement" className="inline-flex items-center justify-center rounded-2xl bg-white px-7 py-4 text-base font-bold text-stone-800 ring-1 ring-stone-200 transition hover:ring-brand-300">
                Voir comment ça marche
              </a>
            </div>
            <ul className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-sm text-stone-600">
              {["Gratuit pour 1 compteur", "Sans mot de passe", "Sans engagement"].map((t) => (
                <li key={t} className="flex items-center gap-1.5"><Icon name="check" className="h-4 w-4 text-emerald-600" /> {t}</li>
              ))}
            </ul>
            <div className="mt-6"><InstallButton /></div>
          </div>
          <div className="animate-fade-up lg:justify-self-end" style={{ animationDelay: "120ms" }}>
            <PhoneMockup />
          </div>
        </div>
      </section>

      {/* Chiffres */}
      <section className="mx-auto max-w-6xl px-5">
        <div className="reveal grid gap-4 rounded-3xl bg-stone-900 p-6 text-white sm:grid-cols-3 sm:p-8">
          {[
            ["58 %", "des clients CIE sont en compteur prépayé (CIE, 2022)."],
            ["2 h du matin", "l'heure où la coupure surprend, quand plus personne ne peut recharger."],
            ["3 alertes", "avant l'épuisement prévu : 5 jours, 2 jours et la veille, à 18 h."],
          ].map(([big, text]) => (
            <div key={big} className="rounded-2xl bg-white/5 p-5 ring-1 ring-white/10">
              <p className="text-3xl font-extrabold text-brand-400">{big}</p>
              <p className="mt-2 text-sm text-stone-300">{text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Comment ça marche */}
      <section id="fonctionnement" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-24">
        <div className="reveal max-w-2xl">
          <p className="text-sm font-bold tracking-wide text-brand-700 uppercase">Comment ça marche</p>
          <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">Trois gestes, et tu ne subis plus les coupures.</h2>
        </div>
        <ol className="mt-12 grid gap-5 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="reveal relative rounded-3xl bg-white p-6 shadow-sm ring-1 ring-stone-200" style={{ transitionDelay: `${i * 80}ms` }}>
              <span className="absolute top-5 right-6 text-5xl font-extrabold text-brand-100">{i + 1}</span>
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-600 text-white shadow-lg shadow-brand-600/30">
                <Icon name={s.icon} className="h-6 w-6" />
              </span>
              <h3 className="mt-5 text-lg font-bold">{s.title}</h3>
              <p className="mt-2 text-stone-600">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Calendrier des alertes */}
      <section className="mx-auto max-w-6xl px-5">
        <div className="reveal bg-hero overflow-hidden rounded-[2rem] p-8 text-white sm:p-12">
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <div>
              <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Prévenu au bon moment, sur le bon canal.</h2>
              <p className="mt-4 text-white/85">
                Les alertes partent à 18 h, jamais pendant tes heures calmes. Une seule alerte de chaque sorte par recharge : utile, jamais envahissant.
              </p>
            </div>
            <ol className="space-y-3">
              {[
                ["J-5", "Environ 5 jours de courant", "Prévois ta recharge."],
                ["J-2", "Plus que 2 jours", "Recharge avant la date indiquée."],
                ["Veille", "Coupure possible cette nuit", "Rappel à 21 h si besoin."],
              ].map(([tag, title, sub]) => (
                <li key={tag} className="flex items-center gap-4 rounded-2xl bg-white/15 p-4 ring-1 ring-white/25 backdrop-blur">
                  <span className="grid h-12 w-16 shrink-0 place-items-center rounded-xl bg-white text-sm font-extrabold text-brand-700">{tag}</span>
                  <div>
                    <p className="font-bold">{title}</p>
                    <p className="text-sm text-white/80">{sub}</p>
                  </div>
                  <span className="ml-auto text-sm font-semibold text-white/80">18:00</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* Fonctionnalités */}
      <section id="fonctionnalites" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-24">
        <div className="reveal max-w-2xl">
          <p className="text-sm font-bold tracking-wide text-brand-700 uppercase">Fonctionnalités</p>
          <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">Tout ton courant, enfin lisible.</h2>
        </div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f, i) => (
            <div key={f.title} className="reveal group rounded-3xl bg-white p-6 ring-1 ring-stone-200 transition hover:-translate-y-1 hover:shadow-xl hover:shadow-brand-600/10 hover:ring-brand-200" style={{ transitionDelay: `${(i % 4) * 70}ms` }}>
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-50 text-brand-700 ring-1 ring-brand-100 transition group-hover:bg-brand-600 group-hover:text-white">
                <Icon name={f.icon} className="h-5 w-5" />
              </span>
              <h3 className="mt-4 font-bold">{f.title}</h3>
              <p className="mt-1.5 text-sm text-stone-600">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Tarifs */}
      <section id="tarifs" className="scroll-mt-20 bg-white py-24">
        <div className="mx-auto max-w-6xl px-5">
          <div className="reveal mx-auto max-w-2xl text-center">
            <p className="text-sm font-bold tracking-wide text-brand-700 uppercase">Tarifs</p>
            <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">Gratuit pour commencer. Sans engagement ensuite.</h2>
            <p className="mt-3 text-stone-600">Paiement mensuel par Wave, Orange Money, MTN MoMo ou Moov Money.</p>
          </div>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {(plans ?? []).map((p, i) => {
              const featured = i === 1;
              return (
                <div
                  key={p.code}
                  className={`reveal relative flex flex-col rounded-3xl p-7 ${featured ? "bg-stone-900 text-white shadow-2xl shadow-brand-900/20 lg:-translate-y-3" : "bg-stone-50 ring-1 ring-stone-200"}`}
                >
                  {featured && <span className="absolute -top-3 left-7 rounded-full bg-brand-500 px-3 py-1 text-xs font-bold text-white">Recommandé</span>}
                  <h3 className="text-lg font-bold">{p.name}</h3>
                  <p className="mt-4">
                    <span className="text-4xl font-extrabold">{p.price_fcfa === 0 ? "0" : fcfa(p.price_fcfa).replace(" FCFA", "")}</span>
                    <span className={featured ? "text-stone-300" : "text-stone-500"}> FCFA / mois</span>
                  </p>
                  <ul className={`mt-6 flex-1 space-y-3 text-sm ${featured ? "text-stone-200" : "text-stone-700"}`}>
                    <li className="flex gap-2"><Icon name="check" className="h-5 w-5 shrink-0 text-brand-500" /> {p.max_meters} compteur{p.max_meters > 1 ? "s" : ""}</li>
                    <li className="flex gap-2"><Icon name="check" className="h-5 w-5 shrink-0 text-brand-500" /> Prévision et jours restants</li>
                    <li className="flex gap-2"><Icon name="check" className="h-5 w-5 shrink-0 text-brand-500" /> Alertes : {p.channels.map((c) => CHANNEL_LABELS[c].toLowerCase()).join(", ")}</li>
                    <li className="flex gap-2"><Icon name="check" className="h-5 w-5 shrink-0 text-brand-500" /> Historique {p.history_days ? `de ${p.history_days} jours` : "illimité"}</li>
                  </ul>
                  <Link
                    to={R.connexion}
                    className={`mt-8 rounded-2xl py-3.5 text-center font-bold transition ${featured ? "bg-brand-500 text-white hover:bg-brand-400" : "bg-white text-stone-900 ring-1 ring-stone-300 hover:ring-brand-400"}`}
                  >
                    {p.price_fcfa === 0 ? "Commencer gratuitement" : `Choisir ${p.name}`}
                  </Link>
                </div>
              );
            })}
            {plans === null && [0, 1, 2, 3].map((i) => <div key={i} className="h-96 animate-pulse rounded-3xl bg-stone-100" />)}
          </div>
        </div>
      </section>

      {/* Questions */}
      <section id="questions" className="mx-auto max-w-3xl scroll-mt-20 px-5 py-24">
        <h2 className="reveal text-center text-3xl font-extrabold tracking-tight sm:text-4xl">Questions fréquentes</h2>
        <div className="mt-10 space-y-3">
          {FAQ.map((f) => (
            <details key={f.q} className="reveal group rounded-2xl bg-white p-5 ring-1 ring-stone-200 open:ring-brand-200">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
                {f.q}
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-700 transition group-open:rotate-45">
                  <Icon name="plus" className="h-4 w-4" />
                </span>
              </summary>
              <p className="mt-3 text-stone-600">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Appel final */}
      <section className="mx-auto max-w-6xl px-5 pb-20">
        <div className="reveal relative overflow-hidden rounded-[2rem] bg-stone-900 px-8 py-14 text-center text-white">
          <div className="absolute -top-24 left-1/2 h-64 w-[36rem] -translate-x-1/2 rounded-full bg-brand-500/40 blur-3xl" aria-hidden />
          <h2 className="relative text-3xl font-extrabold tracking-tight sm:text-4xl">Ton prochain relevé, c'est maintenant.</h2>
          <p className="relative mx-auto mt-3 max-w-xl text-stone-300">Crée ton compte avec ton email, ajoute ton compteur et envoie ta première photo. C'est gratuit.</p>
          <Link to={R.connexion} className="animate-pulse-ring relative mt-8 inline-flex items-center gap-2 rounded-2xl bg-brand-500 px-8 py-4 font-bold text-white hover:bg-brand-400">
            Commencer gratuitement <Icon name="arrowRight" className="h-5 w-5" />
          </Link>
        </div>
      </section>

      <footer className="border-t border-brand-100 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-8 text-sm text-stone-500 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2">
            <Logo className="h-7 w-7" />
            <span>© {new Date().getFullYear()} PréviÉnergie · Data Intelligence Group</span>
          </div>
          <p className="font-medium text-stone-600">Service indépendant, non affilié à la CIE.</p>
          <div className="flex gap-5">
            <Link to={R.confidentialite} className="hover:text-brand-700">Confidentialité</Link>
            <a href="mailto:contact@previenergie.ci" className="hover:text-brand-700">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
