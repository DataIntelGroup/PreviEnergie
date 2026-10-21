// Petits composants d'interface, mobile d'abord : grosses zones tactiles,
// texte lisible, orange et blanc.
import {
  type ButtonHTMLAttributes,
  type ComponentProps,
  createContext,
  type ReactNode,
  type SelectHTMLAttributes,
  useCallback,
  useContext,
  useId,
  useEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-200",
  secondary: "bg-white text-brand-700 ring-1 ring-brand-200 hover:bg-brand-50 disabled:text-stone-400",
  ghost: "text-brand-700 hover:bg-brand-50 disabled:text-stone-400",
  danger: "bg-red-600 text-white hover:bg-red-700 disabled:bg-red-200",
};

export function Button({
  variant = "primary",
  loading,
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 text-base font-semibold transition active:scale-[0.97] disabled:cursor-not-allowed disabled:active:scale-100 ${VARIANTS[variant]} ${loading ? "btn-loading" : ""} ${className}`}
    >
      {loading && <BoltSpinner />}
      {children}
    </button>
  );
}

/** Anneau qui tourne autour d'un éclair qui bat : l'état « en cours » des boutons. */
function BoltSpinner() {
  return (
    <span className="relative grid h-5 w-5 place-items-center" aria-hidden>
      <svg className="absolute inset-0 animate-spin" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
        <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      <svg className="btn-bolt h-2.5 w-2.5" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 3 14h9l-1 8 10-12h-9z" /></svg>
    </span>
  );
}

export function Spinner({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

const LOADER_MESSAGES = ["On allume la lumière…", "On lit ton compteur…", "On calcule tes jours de courant…"];

/**
 * Écran de chargement de marque, identique à celui d'index.html (mêmes
 * classes, styles définis là-bas) : l'utilisateur voit un seul écran
 * continu entre l'ouverture et l'app prête. `delay` : n'apparaît qu'après
 * un court instant, pour ne pas clignoter quand le chargement est rapide.
 */
export function AppLoader({ message, delay = false }: { message?: string; delay?: boolean }) {
  const messages = message ? [message] : LOADER_MESSAGES;
  return (
    <div className={`pe-splash ${delay ? "pe-splash--delay" : ""}`} role="status" aria-label={message ?? "Chargement de PréviÉnergie"}>
      <div className="pe-splash__stage">
        <div className="pe-splash__glow" />
        <div className="pe-splash__mark">
          <svg viewBox="0 0 512 512" aria-hidden>
            <rect width="512" height="512" rx="112" fill="#ea580c" />
            <circle cx="256" cy="256" r="168" fill="none" stroke="#fff" strokeOpacity="0.22" strokeWidth="28" />
            <circle className="pe-arc" cx="256" cy="256" r="168" />
            <path className="pe-bolt" d="M282 112 172 286h72l-22 114 112-178h-74z" />
          </svg>
        </div>
        <span className="pe-splash__spark" />
        <span className="pe-splash__spark" />
        <span className="pe-splash__spark" />
      </div>
      <p className="pe-splash__brand">
        Prévi<span>Énergie</span>
      </p>
      <div className={`pe-splash__msgs ${messages.length === 1 ? "pe-splash__msgs--one" : ""}`}>
        {messages.map((m) => <span key={m}>{m}</span>)}
      </div>
      <div className="pe-splash__bar"><i /></div>
    </div>
  );
}

export const FullPageSpinner = () => <AppLoader />;

export function Field({
  label,
  hint,
  error,
  children,
  id,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: (id: string) => ReactNode;
  id?: string;
}) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <div className="space-y-1.5">
      <label htmlFor={fid} className="block text-sm font-medium text-stone-700">
        {label}
      </label>
      {children(fid)}
      {error ? <p className="text-sm text-red-600">{error}</p> : hint ? <p className="text-sm text-stone-500">{hint}</p> : null}
    </div>
  );
}

const inputClass =
  "block w-full min-h-12 rounded-xl border border-stone-300 bg-white px-4 text-base text-stone-900 placeholder:text-stone-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:bg-stone-100";

export function Input(props: ComponentProps<"input">) {
  return <input {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200 ${className}`}>{children}</div>;
}

export function Notice({
  tone = "info",
  children,
  className = "",
}: {
  tone?: "info" | "warning" | "error" | "success";
  children: ReactNode;
  className?: string;
}) {
  const tones = {
    info: "bg-brand-50 text-brand-800 ring-brand-200",
    warning: "bg-amber-50 text-amber-900 ring-amber-200",
    error: "bg-red-50 text-red-800 ring-red-200",
    success: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  };
  return (
    <div role={tone === "error" ? "alert" : undefined} className={`rounded-xl px-4 py-3 text-sm ring-1 ${tones[tone]} ${className}`}>
      {children}
    </div>
  );
}

export function PageTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-extrabold tracking-tight text-stone-900 sm:text-3xl">{children}</h1>
      {action}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-start justify-between gap-4 py-3 ${disabled ? "opacity-50" : ""}`}>
      <span>
        <span className="block font-medium text-stone-900">{label}</span>
        {description && <span className="block text-sm text-stone-500">{description}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden
        className="relative mt-1 h-7 w-12 shrink-0 rounded-full bg-stone-300 transition-colors after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-transform peer-checked:bg-brand-600 peer-checked:after:translate-x-5 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-300"
      />
    </label>
  );
}

// ---------------------------------------------------------------- toasts
interface Toast {
  id: number;
  text: string;
  tone: "success" | "error";
}

const ToastContext = createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const show = useCallback((text: string, tone: Toast["tone"] = "success") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-4" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`animate-fade-up rounded-xl px-4 py-3 text-sm font-medium shadow-lg ${t.tone === "error" ? "bg-red-600 text-white" : "bg-stone-900 text-white"}`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

// ---------------------------------------------------------------- feuille modale
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  // Échap ferme la fenêtre ; la page derrière ne défile plus tant qu'elle est ouverte.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  if (!open) return null;
  // Rendue directement dans <body> : un parent animé (fondu de page) ne peut
  // plus la coincer dans la zone de contenu.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-[2px] sm:items-center sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="animate-fade-up max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 pb-safe shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky -top-5 z-10 -mx-5 -mt-5 mb-4 flex items-center justify-between rounded-t-3xl bg-white px-5 pt-5 pb-2">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="rounded-full p-2 text-stone-500 transition hover:bg-stone-100 active:scale-90" aria-label="Fermer">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function Independence({ className = "" }: { className?: string }) {
  return <p className={`text-center text-xs text-stone-500 ${className}`}>Service indépendant, non affilié à la CIE.</p>;
}
