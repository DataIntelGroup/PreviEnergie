// Connexion (BF-01) : email ou numéro de téléphone, et mot de passe. Création
// de compte par email et mot de passe ; le profil (prénom, nom, numéro) est
// demandé juste après. Mot de passe oublié : demande à l'équipe, qui envoie
// un code à 6 chiffres par WhatsApp au numéro du compte ; avec ce code, on
// choisit le nouveau mot de passe ici même (fonction mot-de-passe).
import { isValidPhone, normalizePhone, PASSWORD_MIN } from "@shared/validation.ts";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { BareLayout } from "@/components/Layout";
import { Button, Field, Input, Notice } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { safeNext } from "@/lib/routes";
import { callFunction, errorMessage, isConfigured, supabase } from "@/lib/supabase";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
type Step = "connexion" | "inscription" | "oubli" | "code";

export default function Connexion() {
  const { session } = useAuth();
  const [params] = useSearchParams();
  const [step, setStep] = useState<Step>(params.has("inscription") ? "inscription" : "connexion");
  const [login, setLogin] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  if (session) return <Navigate to={safeNext(params.get("suite"))} replace />;

  const go = (s: Step) => {
    setStep(s);
    setError(null);
    setInfo(null);
  };

  async function signIn(e?: FormEvent) {
    e?.preventDefault();
    const id = login.trim();
    if (!id || !password) return setError("Entre ton email ou ton numéro, et ton mot de passe.");
    setBusy(true);
    setError(null);
    try {
      if (id.includes("@")) {
        const { error } = await supabase.auth.signInWithPassword({ email: id.toLowerCase(), password });
        if (error) throw new Error(error.status === 400 ? "Email ou mot de passe incorrect." : errorMessage(error));
      } else {
        if (!isValidPhone(id)) throw new Error("Numéro invalide : 10 chiffres commençant par 01, 05, 07, 21, 25 ou 27.");
        const tokens = await callFunction<{ access_token: string; refresh_token: string }>("connexion", { phone: normalizePhone(id), password });
        const { error } = await supabase.auth.setSession(tokens);
        if (error) throw error;
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function signUp(e?: FormEvent) {
    e?.preventDefault();
    const id = email.trim();
    const byPhone = !id.includes("@");
    const clean = id.toLowerCase();
    if (byPhone ? !isValidPhone(id) : !EMAIL_RE.test(clean)) {
      return setError(byPhone ? "Entre ton email, ou un numéro de 10 chiffres commençant par 01, 05, 07, 21, 25 ou 27." : "Entre une adresse email valide.");
    }
    if (password.length < PASSWORD_MIN) return setError(`Le mot de passe doit faire au moins ${PASSWORD_MIN} caractères.`);
    if (password !== password2) return setError("Les deux mots de passe sont différents.");
    setBusy(true);
    setError(null);
    if (byPhone) {
      try {
        const tokens = await callFunction<{ access_token: string; refresh_token: string }>("inscription", {
          phone: normalizePhone(id),
          password,
          source: params.get("source") ?? params.get("utm_source") ?? "",
        });
        const { error } = await supabase.auth.setSession(tokens);
        if (error) throw error;
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setBusy(false);
      }
      return;
    }
    const { data, error } = await supabase.auth.signUp({
      email: clean,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}${safeNext(params.get("suite"))}`,
        data: { source: params.get("source") ?? params.get("utm_source") ?? "" },
      },
    });
    setBusy(false);
    if (error) {
      return setError(/already|registered|exists/i.test(error.message) ? "Un compte existe déjà avec cet email : connecte-toi, ou « Mot de passe oublié »." : errorMessage(error));
    }
    // Email déjà pris (Supabase ne le dit pas toujours) : aucune identité créée.
    if (data.user && data.user.identities?.length === 0) {
      return setError("Un compte existe déjà avec cet email : connecte-toi, ou « Mot de passe oublié ».");
    }
    if (!data.session) {
      setEmail(clean);
      setInfo(`Compte créé. Ouvre l'email envoyé à ${clean} pour le confirmer, puis connecte-toi.`);
      go("connexion");
      setLogin(clean);
    }
  }

  async function requestReset(e?: FormEvent) {
    e?.preventDefault();
    const id = login.trim();
    if (!id.includes("@") && !isValidPhone(id)) return setError("Entre ton email ou ton numéro de 10 chiffres.");
    setBusy(true);
    setError(null);
    try {
      await callFunction("mot-de-passe", { action: "demander", login: id.includes("@") ? id.toLowerCase() : normalizePhone(id) });
      setPassword("");
      setPassword2("");
      go("code");
      setInfo("Demande reçue. Tu vas recevoir un code à 6 chiffres par WhatsApp, au numéro de ton compte.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(e?: FormEvent) {
    e?.preventDefault();
    const id = login.trim();
    const token = code.replace(/\D/g, "");
    if (token.length !== 6) return setError("Le code contient 6 chiffres.");
    if (password.length < PASSWORD_MIN) return setError(`Le mot de passe doit faire au moins ${PASSWORD_MIN} caractères.`);
    if (password !== password2) return setError("Les deux mots de passe sont différents.");
    setBusy(true);
    setError(null);
    try {
      const tokens = await callFunction<{ access_token: string; refresh_token: string }>("mot-de-passe", {
        action: "reinitialiser",
        login: id.includes("@") ? id.toLowerCase() : normalizePhone(id),
        code: token,
        password,
      });
      const { error } = await supabase.auth.setSession(tokens);
      if (error) throw error;
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const tabs = (
    <div className="mt-8 grid grid-cols-2 gap-1 rounded-2xl bg-stone-100 p-1" role="tablist">
      {([["connexion", "Se connecter"], ["inscription", "Créer un compte"]] as [Step, string][]).map(([s, label]) => (
        <button
          key={s}
          type="button"
          role="tab"
          aria-selected={step === s}
          onClick={() => go(s)}
          className={`rounded-xl py-2.5 text-sm font-bold transition ${step === s ? "bg-white text-brand-700 shadow-sm" : "text-stone-600 hover:text-stone-900"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  const link = (label: ReactNode, onClick: () => void) => (
    <button type="button" className="font-medium text-brand-700 hover:text-brand-800" onClick={onClick}>{label}</button>
  );

  return (
    <BareLayout back>
      <h1 className="text-3xl font-extrabold text-stone-900">Plus jamais de coupure surprise.</h1>
      <p className="mt-3 text-stone-600">
        Envoie un relevé de ton compteur en quelques secondes, PréviÉnergie calcule ta consommation et te prévient avant la coupure.
      </p>

      {!isConfigured && (
        <Notice tone="warning" className="mt-6">
          Application non configurée : renseigne VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY dans .env.local.
        </Notice>
      )}

      {(step === "connexion" || step === "inscription") && tabs}

      {step === "connexion" && (
        <form onSubmit={signIn} className="mt-6 space-y-4" noValidate>
          {info && <Notice tone="success">{info}</Notice>}
          <Field label="Email ou numéro de téléphone">
            {(id) => (
              <Input id={id} autoComplete="username" inputMode="email" placeholder="prenom@exemple.com ou 07 00 00 00 00" value={login} onChange={(e) => setLogin(e.target.value)} />
            )}
          </Field>
          <Field label="Mot de passe">
            {(id) => <Input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
          </Field>
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" loading={busy} className="w-full">Me connecter</Button>
          <p className="text-center text-sm">
            {link("Mot de passe oublié ?", () => go("oubli"))}
          </p>
        </form>
      )}

      {step === "inscription" && (
        <form onSubmit={signUp} className="mt-6 space-y-4" noValidate>
          <Field label="Email ou numéro de téléphone">
            {(id) => <Input id={id} autoComplete="username" inputMode="email" placeholder="prenom@exemple.com ou 07 00 00 00 00" value={email} onChange={(e) => setEmail(e.target.value)} />}
          </Field>
          <Field label="Choisis un mot de passe" hint={`${PASSWORD_MIN} caractères au moins.`}>
            {(id) => <Input id={id} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
          </Field>
          <Field label="Retape le mot de passe">
            {(id) => <Input id={id} type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} />}
          </Field>
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" loading={busy} className="w-full">Créer mon compte</Button>
          <p className="text-center text-sm text-stone-500">
            {email.trim() && !email.includes("@")
              ? "Ensuite : ton prénom et ton nom. Mot de passe oublié ? On t'enverra un code par WhatsApp à ce numéro."
              : "Ensuite : ton prénom, ton nom et ton numéro. Tu pourras te connecter avec l'email ou le numéro."}
          </p>
        </form>
      )}

      {step === "oubli" && (
        <form onSubmit={requestReset} className="mt-8 space-y-4" noValidate>
          <h2 className="text-lg font-bold text-stone-900">Mot de passe oublié</h2>
          <p className="text-stone-700">
            Entre l'email ou le numéro de ton compte. On t'envoie un code à 6 chiffres par WhatsApp, au numéro enregistré sur ton compte, pour choisir un nouveau mot de passe.
          </p>
          <Field label="Email ou numéro de téléphone">
            {(id) => <Input id={id} autoComplete="username" inputMode="email" placeholder="prenom@exemple.com ou 07 00 00 00 00" value={login} onChange={(e) => setLogin(e.target.value)} />}
          </Field>
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" loading={busy} className="w-full">Recevoir un code</Button>
          <div className="flex justify-between text-sm">
            {link("← Retour", () => go("connexion"))}
            {link("J'ai déjà un code", () => {
              const id = login.trim();
              if (!id.includes("@") && !isValidPhone(id)) return setError("Entre d'abord ton email ou ton numéro.");
              go("code");
            })}
          </div>
        </form>
      )}

      {step === "code" && (
        <form onSubmit={resetPassword} className="mt-8 space-y-4" noValidate>
          <h2 className="text-lg font-bold text-stone-900">Nouveau mot de passe</h2>
          {info ? <Notice tone="success">{info}</Notice> : (
            <p className="text-stone-700">Saisis le code reçu par WhatsApp pour <strong>{login.trim()}</strong>, puis ton nouveau mot de passe.</p>
          )}
          <Field label="Code à 6 chiffres">
            {(id) => (
              <Input
                id={id}
                ref={codeRef}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="123456"
                className="tabular text-center text-2xl tracking-[0.5em]"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              />
            )}
          </Field>
          <Field label="Nouveau mot de passe" hint={`${PASSWORD_MIN} caractères au moins.`}>
            {(id) => <Input id={id} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
          </Field>
          <Field label="Retape le mot de passe">
            {(id) => <Input id={id} type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} />}
          </Field>
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" loading={busy} className="w-full" disabled={code.length !== 6}>Changer mon mot de passe</Button>
          <p className="text-sm text-stone-500">
            Pas de code au bout de 30 minutes ? Écris-nous à <a href="mailto:contact@previenergie.ci" className="font-medium text-brand-700">contact@previenergie.ci</a> avec ton numéro.
          </p>
          <div className="text-sm">{link("← Retour à la connexion", () => { setCode(""); go("connexion"); })}</div>
        </form>
      )}
    </BareLayout>
  );
}
