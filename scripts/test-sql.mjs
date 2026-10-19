// Contrôles des règles d'accès et des fonctions SQL sur une base jetable.
// Sans TEST_DB_URL : démarre un PostgreSQL 18 local dans un dossier
// temporaire, applique l'imitation de Supabase puis les migrations.
//   npm run test:sql
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import pg from "pg";

const ROOT = resolve(import.meta.dirname, "..");
const PG_BIN = process.env.PG_BIN ?? "C:/Program Files/PostgreSQL/18/bin";
const PORT = 54329;

let dataDir = null;
let url = process.env.TEST_DB_URL;

function startLocal() {
  dataDir = mkdtempSync(join(tmpdir(), "previenergie-pg-"));
  execFileSync(join(PG_BIN, "initdb"), ["-D", dataDir, "-U", "postgres", "-A", "trust", "-E", "UTF8", "--locale=C"], { stdio: "ignore" });
  execFileSync(join(PG_BIN, "pg_ctl"), ["-D", dataDir, "-o", `-p ${PORT}`, "-l", join(dataDir, "log.txt"), "-w", "start"], { stdio: "ignore" });
  url = `postgresql://postgres@localhost:${PORT}/postgres`;
}

function stopLocal() {
  if (!dataDir) return;
  try {
    execFileSync(join(PG_BIN, "pg_ctl"), ["-D", dataDir, "-m", "fast", "-w", "stop"], { stdio: "ignore" });
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}

let passed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  ÉCHEC ${name}\n        ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg ?? "assertion fausse");
}

async function main() {
  if (!url) startLocal();
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  await db.query("set client_min_messages = warning");

  await db.query(readFileSync(join(ROOT, "tests/sql/supabase-stub.sql"), "utf8"));
  const migrations = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
  for (const f of migrations) {
    await db.query(readFileSync(join(ROOT, "supabase/migrations", f), "utf8"));
  }
  console.log(`${migrations.length} migrations appliquées.\n`);

  /** Exécute `fn` dans une transaction, sous un rôle et une identité donnés. */
  async function as(role, uid, fn) {
    await db.query("begin");
    try {
      await db.query(`set local role ${role}`);
      await db.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(uid ? { sub: uid, role } : { role }),
      ]);
      const out = await fn((sql, params) => db.query(sql, params));
      await db.query("commit");
      return out;
    } catch (e) {
      await db.query("rollback");
      throw e;
    }
  }
  const user = (uid, fn) => as("authenticated", uid, fn);
  const anon = (fn) => as("anon", null, fn);
  const service = (fn) => as("service_role", null, fn);

  async function rejects(fn, pattern) {
    try {
      await fn();
    } catch (e) {
      const text = `${e.code ?? ""} ${e.message}`;
      if (pattern && !pattern.test(text)) throw new Error(`erreur inattendue : ${text}`);
      return;
    }
    throw new Error("aurait dû être refusé");
  }

  async function newUser(email) {
    const { rows } = await db.query("insert into auth.users (email) values ($1) returning id", [email]);
    return rows[0].id;
  }
  async function completeProfile(uid, phone) {
    await user(uid, (q) =>
      q("update profiles set first_name = 'Awa', last_name = 'Koné', phone = $1 where id = $2", [phone, uid]),
    );
  }

  const A = await newUser("awa@previenergie.test");
  const B = await newUser("yao@previenergie.test");
  const SUPPORT = await newUser("support@previenergie.test");
  const ADMIN = await newUser("admin@previenergie.test");
  await db.query("update profiles set role = 'support', first_name = 'Sup', last_name = 'Port', phone = '0700000001' where id = $1", [SUPPORT]);
  await db.query("update profiles set role = 'admin', first_name = 'Ad', last_name = 'Min', phone = '0700000002' where id = $1", [ADMIN]);

  console.log("Comptes et profils");
  await check("le profil est créé à la première connexion", async () => {
    const { rows } = await db.query("select email, plan_code from profiles where id = $1", [A]);
    assert(rows[0]?.email === "awa@previenergie.test" && rows[0].plan_code === "gratuit");
  });
  await check("anon ne lit pas les profils", () => rejects(() => anon((q) => q("select * from profiles")), /42501|permission/));
  await check("anon lit les offres actives seulement, sans pouvoir les modifier", async () => {
    await db.query("update plans set active = false where code = 'famille_pro'");
    const { rows } = await anon((q) => q("select code from plans order by sort"));
    await db.query("update plans set active = true where code = 'famille_pro'");
    assert(rows.map((r) => r.code).join() === "gratuit,essentiel", rows.map((r) => r.code).join());
    await rejects(() => anon((q) => q("update plans set price_fcfa = 0")), /42501|permission/);
  });
  await check("anon ne lit pas les réglages", () => rejects(() => anon((q) => q("select * from settings")), /42501|permission/));
  await check("un utilisateur ne voit que son profil", async () => {
    const { rows } = await user(A, (q) => q("select id from profiles"));
    assert(rows.length === 1 && rows[0].id === A, `${rows.length} profils vus`);
  });
  await check("profil incomplet : pas de compteur", () =>
    rejects(() => user(A, (q) => q("insert into meters (name) values ('Maison')")), /42501|row-level/));
  await check("téléphone invalide refusé", () =>
    rejects(() => user(A, (q) => q("update profiles set phone = '0800000000' where id = $1", [A])), /23514|check/));
  await check("téléphone, prénom et nom acceptés", async () => {
    await completeProfile(A, "0707070707");
    await completeProfile(B, "0505050505");
    const { rows } = await db.query("select phone from profiles where id = $1", [A]);
    assert(rows[0].phone === "0707070707");
  });
  await check("l'utilisateur ne change pas son offre", () =>
    rejects(() => user(A, (q) => q("update profiles set plan_code = 'famille_pro' where id = $1", [A])), /42501|permission/));
  await check("l'utilisateur ne change pas son rôle", () =>
    rejects(() => user(A, (q) => q("update profiles set role = 'admin' where id = $1", [A])), /42501|permission/));
  await check("l'utilisateur ne se lève pas une suspension", () =>
    rejects(() => user(A, (q) => q("update profiles set suspended = false where id = $1", [A])), /42501|permission/));
  await check("modifier le profil d'un autre ne touche rien", async () => {
    const { rowCount } = await user(A, (q) => q("update profiles set commune = 'Cocody' where id = $1", [B]));
    assert(rowCount === 0);
  });

  console.log("\nCompteurs, relevés, recharges");
  let meterA;
  let meterB;
  await check("création d'un compteur", async () => {
    const { rows } = await user(A, (q) => q("insert into meters (name, kind) values ('Maison', 'prepaid') returning id, user_id"));
    meterA = rows[0].id;
    assert(rows[0].user_id === A);
    meterB = (await user(B, (q) => q("insert into meters (name) values ('Boutique') returning id"))).rows[0].id;
  });
  await check("offre gratuite : un seul compteur", () =>
    rejects(() => user(A, (q) => q("insert into meters (name) values ('Boutique')")), /meter_limit|compteur/));
  await check("un compteur ne peut pas être créé pour un autre", () =>
    rejects(() => user(A, (q) => q("insert into meters (name, user_id) values ('X', $1)", [B])), /42501|row-level/));
  await check("les compteurs d'un autre sont invisibles", async () => {
    const { rows } = await user(A, (q) => q("select id from meters"));
    assert(rows.length === 1 && rows[0].id === meterA);
  });
  await check("relevé sur son compteur", async () => {
    await user(A, (q) => q("insert into readings (meter_id, value, taken_at) values ($1, 40, now() - interval '2 days'), ($1, 35, now() - interval '1 day')", [meterA]));
  });
  await check("relevé sur le compteur d'un autre refusé", () =>
    rejects(() => user(A, (q) => q("insert into readings (meter_id, value) values ($1, 10)", [meterB])), /42501|row-level/));
  await check("relevé attribué à un autre refusé", () =>
    rejects(() => user(A, (q) => q("insert into readings (meter_id, user_id, value) values ($1, $2, 10)", [meterA, B])), /42501|row-level/));
  await check("recharge sur son compteur, moyen de paiement contrôlé", async () => {
    await user(A, (q) => q("insert into recharges (meter_id, kwh, amount_fcfa, payment_method, code) values ($1, 45, 5000, 'wave', '1234-5678')", [meterA]));
    await rejects(() => user(A, (q) => q("insert into recharges (meter_id, kwh, payment_method) values ($1, 5, 'bitcoin')", [meterA])), /23514|check/);
  });
  await check("les relevés d'un autre sont invisibles et indestructibles", async () => {
    await user(B, (q) => q("insert into readings (meter_id, value) values ($1, 99)", [meterB]));
    const seen = await user(A, (q) => q("select meter_id from readings"));
    assert(seen.rows.every((r) => r.meter_id === meterA), "relevé étranger visible");
    const del = await user(A, (q) => q("delete from readings where meter_id = $1", [meterB]));
    assert(del.rowCount === 0);
  });
  await check("un compte suspendu n'écrit plus", async () => {
    await db.query("update profiles set suspended = true where id = $1", [B]);
    await rejects(() => user(B, (q) => q("insert into readings (meter_id, value) values ($1, 98)", [meterB])), /42501|row-level/);
    await db.query("update profiles set suspended = false where id = $1", [B]);
  });

  console.log("\nTables réservées au serveur");
  await check("l'utilisateur n'écrit pas de prévision", () =>
    rejects(() => user(A, (q) => q("insert into forecasts (meter_id, user_id, status, cycle_key) values ($1, $2, 'standard', 'x')", [meterA, A])), /42501|permission/));
  await check("l'utilisateur n'écrit pas de paiement", () =>
    rejects(() => user(A, (q) => q("insert into payments (user_id, plan_code, amount_fcfa, transaction_id) values ($1, 'essentiel', 1000, 'x')", [A])), /42501|permission/));
  await check("l'utilisateur n'écrit pas d'alerte", () =>
    rejects(() => user(A, (q) => q("insert into alerts (user_id, meter_id, type, channel, cycle_key, status) values ($1, $2, 'veille', 'sms', 'x', 'sent')", [A, meterA])), /42501|permission/));
  await check("l'utilisateur ne lit pas les lectures IA", () =>
    rejects(() => user(A, (q) => q("select * from ai_reads")), /42501|permission/));
  await check("l'utilisateur n'écrit pas les réglages", () =>
    rejects(() => user(A, (q) => q("insert into settings (key, value) values ('thresholds', '{}')")), /42501|permission/));
  await check("l'utilisateur ne lit pas le journal", async () => {
    await db.query("insert into audit_log (action) values ('essai')");
    const { rows } = await user(A, (q) => q("select * from audit_log"));
    assert(rows.length === 0);
  });
  await check("le serveur lit et écrit tout", async () => {
    await service((q) => q("insert into forecasts (meter_id, user_id, status, cycle_key) values ($1, $2, 'standard', 'x')", [meterA, A]));
    await service((q) => q("insert into alerts (user_id, meter_id, type, channel, cycle_key, status) values ($1, $2, 'veille', 'push', 'x', 'sent')", [A, meterA]));
    await service((q) => q("insert into alerts (user_id, meter_id, type, channel, cycle_key, status) values ($1, $2, 'veille', 'push', 'x', 'sent')", [B, meterB]));
  });
  await check("une alerte part une seule fois par type, cycle et canal", () =>
    rejects(() => service((q) => q("insert into alerts (user_id, meter_id, type, channel, cycle_key, status) values ($1, $2, 'veille', 'push', 'x', 'sent')", [A, meterA])), /23505|unique/));
  await check("chacun ne voit que ses alertes", async () => {
    const { rows } = await user(A, (q) => q("select user_id from alerts"));
    assert(rows.length === 1 && rows[0].user_id === A);
  });

  console.log("\nFonctions du back-office");
  await check("anon n'appelle aucune fonction d'administration", () =>
    rejects(() => anon((q) => q("select admin_dashboard(30)")), /42501|permission/));
  await check("un utilisateur n'ouvre pas le tableau de bord", () =>
    rejects(() => user(A, (q) => q("select admin_dashboard(30)")), /42501|Réservé/));
  await check("un utilisateur ne modifie pas d'offre", () =>
    rejects(() => user(A, (q) => q("select admin_update_user($1, 'famille_pro')", [A])), /42501|Réservé/));
  await check("un utilisateur n'active pas de paiement", () =>
    rejects(() => user(A, (q) => q("select apply_payment('x', 'accepted', 'wave', '{}')")), /42501|permission/));
  await check("un utilisateur ne fait pas expirer les offres", () =>
    rejects(() => user(A, (q) => q("select expire_plans()")), /42501|permission/));
  await check("le support ouvre le tableau de bord", async () => {
    const { rows } = await user(SUPPORT, (q) => q("select admin_dashboard(30) as d"));
    const d = rows[0].d;
    assert(d.signups.total === 2, `total ${d.signups.total}`);
    assert(d.activity.readings === 3, `relevés ${d.activity.readings}`);
  });
  await check("le support lit sans modifier", () =>
    rejects(() => user(SUPPORT, (q) => q("select admin_update_user($1, 'famille_pro')", [A])), /42501|administrateurs/));
  await check("recherche par téléphone et par nom", async () => {
    const byPhone = await user(SUPPORT, (q) => q("select admin_users('07 07 07') as r"));
    assert(byPhone.rows[0].r.total === 1 && byPhone.rows[0].r.rows[0].id === A);
    const byName = await user(SUPPORT, (q) => q("select admin_users('koné') as r"));
    assert(byName.rows[0].r.total === 2, `nom : ${byName.rows[0].r.total}`);
  });
  await check("l'admin change une offre, le journal le garde", async () => {
    await user(ADMIN, (q) => q("select admin_update_user($1, 'essentiel')", [B]));
    const { rows } = await db.query("select plan_code, plan_expires_at from profiles where id = $1", [B]);
    assert(rows[0].plan_code === "essentiel" && rows[0].plan_expires_at > new Date());
    const log = await db.query("select count(*)::int n from audit_log where action = 'user.update' and actor_id = $1", [ADMIN]);
    assert(log.rows[0].n === 1);
  });
  await check("l'admin ne se retire pas son propre rôle", () =>
    rejects(() => user(ADMIN, (q) => q("select admin_update_user($1, null, null, 'user')", [ADMIN])), /propre rôle/));
  await check("l'admin modifie un réglage, un réglage inconnu est refusé", async () => {
    await user(ADMIN, (q) => q(`select admin_set_setting('thresholds', '{"j5": 4, "j2": 2}')`));
    const { rows } = await user(A, (q) => q("select value from settings where key = 'thresholds'"));
    assert(rows[0].value.j5 === 4);
    await rejects(() => user(ADMIN, (q) => q(`select admin_set_setting('pirate', '1')`)), /inconnu/);
  });
  await check("prix d'offre en multiple de 5, offre gratuite intouchable", async () => {
    await rejects(() => user(ADMIN, (q) => q("select admin_update_plan('essentiel', 'Essentiel', '', 1002, 2, array['push'], null, true)")), /23514|check/);
    await rejects(() => user(ADMIN, (q) => q("select admin_update_plan('gratuit', 'Gratuit', '', 500, 1, array['push'], 30, true)")), /gratuite/);
    await user(ADMIN, (q) => q("select admin_update_plan('essentiel', 'Essentiel', 'x', 1500, 2, array['push','email','whatsapp','sms'], null, true)"));
  });

  console.log("\nPaiements et expiration");
  await check("paiement accepté : offre active 30 jours", async () => {
    await service((q) => q("insert into payments (user_id, plan_code, amount_fcfa, transaction_id) values ($1, 'famille_pro', 2500, 'TX-OK')", [A]));
    const { rows } = await service((q) => q("select apply_payment('TX-OK', 'accepted', 'wave', '{}') as r"));
    assert(rows[0].r.changed === true);
    const p = (await db.query("select plan_code, plan_expires_at - now() as left from profiles where id = $1", [A])).rows[0];
    assert(p.plan_code === "famille_pro" && p.left.days >= 29, JSON.stringify(p));
  });
  await check("une notification répétée ne prolonge pas deux fois", async () => {
    const before = (await db.query("select plan_expires_at from profiles where id = $1", [A])).rows[0].plan_expires_at;
    const { rows } = await service((q) => q("select apply_payment('TX-OK', 'accepted', 'wave', '{}') as r"));
    const after = (await db.query("select plan_expires_at from profiles where id = $1", [A])).rows[0].plan_expires_at;
    assert(rows[0].r.changed === false && before.getTime() === after.getTime());
  });
  await check("paiement refusé : l'offre n'est pas activée", async () => {
    await service((q) => q("insert into payments (user_id, plan_code, amount_fcfa, transaction_id) values ($1, 'famille_pro', 2500, 'TX-KO')", [B]));
    await service((q) => q("select apply_payment('TX-KO', 'refused', 'orange_money', '{}')"));
    const { rows } = await db.query("select plan_code from profiles where id = $1", [B]);
    assert(rows[0].plan_code === "essentiel");
  });
  await check("l'offre plus large ouvre un deuxième compteur", async () => {
    await user(A, (q) => q("insert into meters (name) values ('Boutique')"));
  });
  await check("une offre échue vaut « gratuit » avant même la tâche d'expiration", async () => {
    await db.query("update profiles set plan_expires_at = now() - interval '1 minute' where id = $1", [A]);
    const { rows } = await user(A, (q) => q("select effective_plan($1) p", [A]));
    assert(rows[0].p === "gratuit");
    await rejects(() => user(A, (q) => q("insert into meters (name) values ('Troisième')")), /meter_limit|compteur/);
  });
  await check("la tâche d'expiration remet l'offre gratuite", async () => {
    const { rows } = await service((q) => q("select expire_plans() n"));
    assert(rows[0].n === 1);
    const p = (await db.query("select plan_code, plan_expires_at from profiles where id = $1", [A])).rows[0];
    assert(p.plan_code === "gratuit" && p.plan_expires_at === null);
  });

  console.log("\nNotifications push");
  await check("un appareil passe au dernier compte abonné", async () => {
    const ep = "https://push.example/abc";
    await user(A, (q) => q("select register_push($1, 'k', 'a', 'ua')", [ep]));
    await user(SUPPORT, (q) => q("select register_push($1, 'k2', 'a2', 'ua')", [ep]));
    const { rows } = await db.query("select user_id, p256dh from push_subscriptions where endpoint = $1", [ep]);
    assert(rows.length === 1 && rows[0].user_id === SUPPORT && rows[0].p256dh === "k2");
    const mine = await user(A, (q) => q("select * from push_subscriptions"));
    assert(mine.rows.length === 0, "l'ancien compte voit encore l'abonnement");
  });
  await check("anon ne s'abonne pas", () =>
    rejects(() => anon((q) => q("select register_push('https://x', 'k', 'a', 'ua')")), /42501|permission/));

  console.log("\nPhotos et suppression de compte");
  await check("photos : chacun dans son dossier", async () => {
    await user(A, (q) => q("insert into storage.objects (bucket_id, name) values ('photos', $1)", [`${A}/releve.jpg`]));
    await rejects(() => user(A, (q) => q("insert into storage.objects (bucket_id, name) values ('photos', $1)", [`${B}/x.jpg`])), /42501|row-level/);
    const seen = await user(B, (q) => q("select name from storage.objects"));
    assert(seen.rows.length === 0);
  });
  await check("le bucket photos est privé", async () => {
    const { rows } = await db.query("select public from storage.buckets where id = 'photos'");
    assert(rows[0].public === false);
  });
  await check("supprimer le compte efface ses données, garde les paiements anonymisés", async () => {
    await db.query("delete from auth.users where id = $1", [B]);
    const left = await db.query("select (select count(*) from meters where user_id = $1)::int m, (select count(*) from readings where user_id = $1)::int r", [B]);
    assert(left.rows[0].m === 0 && left.rows[0].r === 0);
    const pay = await db.query("select user_id from payments where transaction_id = 'TX-KO'");
    assert(pay.rows[0].user_id === null);
  });

  await db.end();
  console.log(`\n${passed} contrôles validés, ${failures.length} en échec.`);
  if (failures.length) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(stopLocal);
