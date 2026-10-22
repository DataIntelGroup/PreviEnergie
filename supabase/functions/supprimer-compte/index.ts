// Suppression du compte par l'utilisateur (BF-03) : voir _shared/compte.ts.
import { deleteAccount } from "../_shared/compte.ts";
import { adminClient, handler, HttpError, json, readJson, requireUser } from "../_shared/serveur.ts";

Deno.serve(handler(async (req) => {
  const user = await requireUser(req);
  const { confirm } = await readJson<{ confirm?: string }>(req);
  if (confirm !== "SUPPRIMER") throw new HttpError(400, "Confirmation manquante");
  await deleteAccount(adminClient(), user.id, null);
  return json(req, { ok: true });
}));
