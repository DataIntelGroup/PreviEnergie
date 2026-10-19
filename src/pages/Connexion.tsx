// Connexion par email avec un code à 6 chiffres, sans mot de passe (BF-01).
// Le compte est créé à la première connexion.
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { BareLayout } from "@/components/Layout";
import { Button, Field, Input, Notice } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { safeNext } from "@/lib/routes";
import { errorMessage, isConfigured, supabase } from "@/lib/supabase";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RESEND_DELAY = 60;

export default function Connexion() {
  const { session } = useAuth();
  const [params] = useSearchParams();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  if (session) return <Navigate to={safeNext(params.get("suite"))} replace />;

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    const clean = email.trim().toLowerCase();
    if (!EMAIL_RE.test(clean)) {
      setError("Entre une adresse email valide.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: clean,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${window.location.origin}${safeNext(params.get("suite"))}`,
        data: { source: params.get("source") ?? params.get("utm_source") ?? "" },
      },
    });
    setBusy(false);
    if (error) {
      setError(error.status === 429 ? "Trop de demandes. Attends une minute avant de redemander un code." : errorMessage(error));
      return;
    }
    setEmail(clean);
    setStep("code");
    setWait(RESEND_DELAY);
  }

  async function verify(e?: FormEvent) {
    e?.preventDefault();
    const token = code.replace(/\D/g, "");
    if (token.length !== 6) {
      setError("Le code contient 6 chiffres.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
    setBusy(false);
    if (error) setError("Code incorrect ou expiré. Vérifie l'email reçu ou demande un nouveau code.");
  }

  return (
    <BareLayout>
      <h1 className="text-3xl font-extrabold text-stone-900">Plus jamais de coupure surprise.</h1>
      <p className="mt-3 text-stone-600">
        Envoie un relevé de ton compteur en quelques secondes, PréviÉnergie calcule ta consommation et te prévient avant la coupure.
      </p>

      {!isConfigured && (
        <Notice tone="warning" className="mt-6">
          Application non configurée : renseigne VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY dans .env.local.
        </Notice>
      )}

      {step === "email" ? (
        <form onSubmit={sendCode} className="mt-8 space-y-4" noValidate>
          <Field label="Ton adresse email" hint="On t'envoie un code à 6 chiffres. Pas de mot de passe.">
            {(id) => (
              <Input
                id={id}
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="prenom@exemple.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            )}
          </Field>
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" loading={busy} className="w-full">
            Recevoir mon code
          </Button>
          <button
            type="button"
            className="w-full text-center text-sm font-medium text-brand-700"
            onClick={() => {
              const clean = email.trim().toLowerCase();
              if (!EMAIL_RE.test(clean)) return setError("Entre d'abord ton adresse email.");
              setEmail(clean);
              setError(null);
              setStep("code");
            }}
          >
            J'ai déjà un code
          </button>
        </form>
      ) : (
        <form onSubmit={verify} className="mt-8 space-y-4" noValidate>
          <p className="text-stone-700">
            Email envoyé à <strong>{email}</strong>. Saisis le code à 6 chiffres ou touche le lien de l'email. Regarde aussi dans les courriers indésirables.
          </p>
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
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                  setCode(v);
                }}
              />
            )}
          </Field>
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" loading={busy} className="w-full" disabled={code.length !== 6}>
            Me connecter
          </Button>
          <div className="flex justify-between text-sm">
            <button type="button" className="font-medium text-brand-700" onClick={() => { setStep("email"); setCode(""); setError(null); }}>
              Changer d'email
            </button>
            <button type="button" className="font-medium text-brand-700 disabled:text-stone-400" disabled={wait > 0 || busy} onClick={() => void sendCode()}>
              {wait > 0 ? `Renvoyer (${wait} s)` : "Renvoyer le code"}
            </button>
          </div>
        </form>
      )}
    </BareLayout>
  );
}
