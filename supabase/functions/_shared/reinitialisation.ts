// Code de réinitialisation du mot de passe : 6 chiffres tirés au hasard,
// gardés en base sous forme d'empreinte liée à la demande (un code volé dans
// une autre demande ne sert à rien). Partagé entre mot-de-passe et admin-demandes.

export function newResetCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, "0");
}

export async function codeHash(resetId: string, code: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${resetId}:${code}`));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
