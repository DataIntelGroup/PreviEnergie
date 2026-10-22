// Suppression d'un compte (BF-03), par son titulaire ou par un
// administrateur : photos d'abord, puis le compte ; la cascade efface profil,
// compteurs, relevés, recharges, factures, partages et alertes. Les paiements
// restent, anonymisés, pour la comptabilité. Réservé au serveur.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";

export async function deleteAccount(db: SupabaseClient, userId: string, actorId: string | null, details: Record<string, unknown> = {}) {
  const bucket = db.storage.from("photos");
  // Les photos sont rangées sous <id>/<compteur>/<fichier>.
  for (;;) {
    const folders = await bucket.list(userId, { limit: 100 });
    if (folders.error) throw folders.error;
    const paths: string[] = [];
    for (const entry of folders.data ?? []) {
      if (entry.id) {
        paths.push(`${userId}/${entry.name}`);
        continue;
      }
      const files = await bucket.list(`${userId}/${entry.name}`, { limit: 1000 });
      if (files.error) throw files.error;
      for (const f of files.data ?? []) paths.push(`${userId}/${entry.name}/${f.name}`);
    }
    if (paths.length === 0) break;
    const removed = await bucket.remove(paths);
    if (removed.error) throw removed.error;
  }

  await db.from("audit_log").insert({ actor_id: actorId, action: "account.delete", target_type: "profile", target_id: userId, details });
  const del = await db.auth.admin.deleteUser(userId);
  if (del.error) throw del.error;
}
