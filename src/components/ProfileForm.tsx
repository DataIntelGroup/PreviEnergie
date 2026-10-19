// Prénom, nom, téléphone obligatoires ; commune facultative (BF-02, BF-03).
import { COMMUNES, formatPhone, isValidPhone, normalizePhone } from "@shared/validation.ts";
import { type FormEvent, useState } from "react";
import { useAuth } from "@/lib/auth";
import { errorMessage, supabase } from "@/lib/supabase";
import type { Profile } from "@/lib/types";
import { Button, Field, Input, Notice, Select } from "./ui";

export function ProfileForm({ profile, submitLabel, onSaved }: { profile: Profile; submitLabel: string; onSaved?: () => void }) {
  const { refreshProfile } = useAuth();
  const [firstName, setFirstName] = useState(profile.first_name ?? "");
  const [lastName, setLastName] = useState(profile.last_name ?? "");
  const [phone, setPhone] = useState(profile.phone ? formatPhone(profile.phone) : "");
  const [commune, setCommune] = useState(profile.commune ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!firstName.trim()) next.firstName = "Ton prénom est obligatoire.";
    if (!lastName.trim()) next.lastName = "Ton nom est obligatoire.";
    if (!isValidPhone(phone)) next.phone = "10 chiffres commençant par 01, 05, 07, 21, 25 ou 27.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase
      .from("profiles")
      .update({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone: normalizePhone(phone),
        commune: commune || null,
      })
      .eq("id", profile.id);
    if (error) {
      setBusy(false);
      setError(errorMessage(error));
      return;
    }
    await refreshProfile();
    setBusy(false);
    onSaved?.();
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field label="Prénom" error={errors.firstName}>
        {(id) => <Input id={id} autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} maxLength={60} />}
      </Field>
      <Field label="Nom" error={errors.lastName}>
        {(id) => <Input id={id} autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={60} />}
      </Field>
      <Field label="Numéro de téléphone" error={errors.phone} hint="Pour les alertes WhatsApp et SMS, si tu les actives.">
        {(id) => (
          <Input
            id={id}
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            placeholder="07 00 00 00 00"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onBlur={() => isValidPhone(phone) && setPhone(formatPhone(normalizePhone(phone)))}
          />
        )}
      </Field>
      <Field label="Commune (facultatif)">
        {(id) => (
          <Select id={id} value={commune} onChange={(e) => setCommune(e.target.value)}>
            <option value="">Choisir…</option>
            {COMMUNES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" loading={busy} className="w-full">
        {submitLabel}
      </Button>
    </form>
  );
}
