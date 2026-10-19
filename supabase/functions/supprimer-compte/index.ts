// Suppression du compte par l'utilisateur (BF-03) : photos d'abord, puis le
// compte ; la cascade efface profil, compteurs, relevés, recharges et
// alertes. Les paiements restent, anonymisés, pour la comptabilité.
import { adminClient, handler, HttpError, json, readJson, requireUser } from "../_shared/serveur.ts";

Deno.serve(handler(async (req) => {
  const user = await requireUser(req);
  const { confirm } = await readJson<{ confirm?: string }>(req);
  if (confirm !== "SUPPRIMER") throw new HttpError(400, "Confirmation manquante");

  const db = adminClient();
  const bucket = db.storage.from("photos");
  // Les photos sont rangées sous <id>/<compteur>/<fichier>.
  for (;;) {
    const folders = await bucket.list(user.id, { limit: 100 });
    if (folders.error) throw folders.error;
    const paths: string[] = [];
    for (const entry of folders.data ?? []) {
      if (entry.id) {
        paths.push(`${user.id}/${entry.name}`);
        continue;
      }
      const files = await bucket.list(`${user.id}/${entry.name}`, { limit: 1000 });
      if (files.error) throw files.error;
      for (const f of files.data ?? []) paths.push(`${user.id}/${entry.name}/${f.name}`);
    }
    if (paths.length === 0) break;
    const removed = await bucket.remove(paths);
    if (removed.error) throw removed.error;
  }

  await db.from("audit_log").insert({ actor_id: null, action: "account.delete", target_type: "profile", target_id: user.id });
  const del = await db.auth.admin.deleteUser(user.id);
  if (del.error) throw del.error;
  return json(req, { ok: true });
}));
