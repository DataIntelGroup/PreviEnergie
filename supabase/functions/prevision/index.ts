// Recalcul de la prévision d'un compteur juste après un relevé ou une
// recharge, pour que la tâche horaire et le back-office soient à jour.
import { forecastFor, forecastRow, loadHistory, loadSettings, type MeterRow } from "../_shared/donnees.ts";
import { adminClient, handler, HttpError, json, readJson, requireUser } from "../_shared/serveur.ts";

Deno.serve(handler(async (req) => {
  const user = await requireUser(req);
  const { meterId } = await readJson<{ meterId?: string }>(req);
  if (!meterId) throw new HttpError(400, "Compteur manquant");

  const db = adminClient();
  const { data: meter, error } = await db
    .from("meters")
    .select("id, user_id, name, kind, created_at")
    .eq("id", meterId)
    .maybeSingle<MeterRow>();
  if (error) throw error;
  if (!meter || meter.user_id !== user.id) throw new HttpError(404, "Compteur introuvable");

  const now = new Date();
  const [settings, history] = await Promise.all([loadSettings(db), loadHistory(db, [meter.id], now)]);
  const f = forecastFor(meter, history.readings.get(meter.id)!, history.recharges.get(meter.id)!, settings, now);
  const row = forecastRow(meter, f, now);
  const up = await db.from("forecasts").upsert(row);
  if (up.error) throw up.error;
  return json(req, row);
}));
