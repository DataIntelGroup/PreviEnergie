// Mise en ligne côté Supabase, étape par étape, à partir de .env.local.
//   npm run deploy -- purge --oui         efface le schéma du premier MVP (une seule fois)
//   npm run deploy -- db                  migrations (suivies comme la CLI Supabase)
//   npm run deploy -- auth                code à 6 chiffres, modèle d'email, SMTP, URL du site
//   npm run deploy -- secrets             secrets des fonctions Edge
//   npm run deploy -- functions           déploiement des fonctions Edge
//   npm run deploy -- cron                tâche horaire des alertes (pg_cron + pg_net)
//   npm run deploy -- admin <email>       désigne un administrateur
//   npm run deploy -- status              état de la base et des fonctions
//   npm run deploy -- all                 db, auth, secrets, functions, cron
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";

const ROOT = resolve(import.meta.dirname, "..");
const URL_ = process.env.VITE_SUPABASE_URL ?? "";
const REF = /^https:\/\/([a-z0-9]+)\.supabase\.co/.exec(URL_)?.[1];
const API = "https://api.supabase.com/v1";

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`${name} manquant dans .env.local`);
    process.exit(1);
  }
  return v;
}

async function withDb(fn) {
  const db = new pg.Client({ connectionString: need("SUPABASE_DB_URL"), ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

async function management(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${need("SUPABASE_ACCESS_TOKEN")}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} : ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// ---------------------------------------------------------------- ancien schéma
// Le projet contenait le schéma du premier MVP (tables alert_preferences,
// message_templates, outage_feedback…), sans son code. Suppression confirmée
// par l'utilisateur le 2026-10-19. Cette étape efface ce que ce schéma a
// créé : objets de public, déclencheurs sur auth.users, politiques du
// stockage, tâches pg_cron, fonctions Edge et photos. Les comptes de
// connexion (auth.users) sont conservés.
// Sauvegarde préalable : sauvegardes/previenergie-ancien-schema-2026-10-19/.
const PURGE_SQL = `
do $purge$
declare r record;
begin
  for r in
    select t.tgname from pg_trigger t
    join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid join pg_namespace pn on pn.oid = p.pronamespace
    where n.nspname = 'auth' and c.relname = 'users' and not t.tgisinternal and pn.nspname = 'public'
  loop
    execute format('drop trigger %I on auth.users', r.tgname);
    raise notice 'déclencheur auth.users supprimé : %', r.tgname;
  end loop;

  for r in select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects'
           and (coalesce(qual, '') like '%photos%' or coalesce(with_check, '') like '%photos%')
  loop
    execute format('drop policy %I on storage.objects', r.policyname);
  end loop;

  for r in select c.relname, c.relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('v', 'm')
  loop
    execute format(case r.relkind when 'm' then 'drop materialized view if exists public.%I cascade' else 'drop view if exists public.%I cascade' end, r.relname);
  end loop;

  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('drop table if exists public.%I cascade', r.tablename);
  end loop;

  for r in select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute 'drop function if exists ' || r.sig || ' cascade';
  end loop;

  for r in select t.typname from pg_type t join pg_namespace n on n.oid = t.typnamespace
           where n.nspname = 'public' and t.typtype in ('e', 'd')
             and not exists (select 1 from pg_depend d where d.objid = t.oid and d.deptype = 'e')
  loop
    execute format('drop type if exists public.%I cascade', r.typname);
  end loop;

  if to_regclass('supabase_migrations.schema_migrations') is not null then
    delete from supabase_migrations.schema_migrations;
  end if;
  if to_regclass('cron.job') is not null then
    perform cron.unschedule(jobid) from cron.job;
  end if;
end $purge$;
`;

async function purge() {
  if (!process.argv.includes("--oui")) {
    console.log("Efface l'ancien schéma, ses fonctions Edge et ses photos. Relancer avec --oui pour confirmer :");
    console.log("  npm run deploy -- purge --oui");
    return;
  }
  await withDb(async (db) => {
    db.on("notice", (n) => console.log(`  ${n.message}`));
    const before = await db.query("select count(*)::int n from pg_tables where schemaname = 'public'");
    await db.query("begin");
    try {
      await db.query(PURGE_SQL);
      await db.query("commit");
    } catch (e) {
      await db.query("rollback");
      throw e;
    }
    const after = await db.query("select count(*)::int n from pg_tables where schemaname = 'public'");
    console.log(`Base : ${before.rows[0].n} table(s) avant, ${after.rows[0].n} après. Comptes de connexion conservés.`);
  });

  // Photos de l'ancien schéma (l'API de stockage efface les fichiers, pas seulement les lignes).
  const key = need("SUPABASE_SERVICE_ROLE_KEY");
  const headers = { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };
  const list = async (prefix) => {
    const res = await fetch(`${URL_}/storage/v1/object/list/photos`, { method: "POST", headers, body: JSON.stringify({ prefix, limit: 1000 }) });
    return res.ok ? res.json() : [];
  };
  const files = [];
  const walk = async (prefix) => {
    for (const e of await list(prefix)) {
      const path = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.id) files.push(path);
      else await walk(path);
    }
  };
  await walk("");
  if (files.length) {
    const res = await fetch(`${URL_}/storage/v1/object/photos`, { method: "DELETE", headers, body: JSON.stringify({ prefixes: files }) });
    console.log(res.ok ? `${files.length} photo(s) effacée(s).` : `Photos non effacées : ${res.status}`);
  }

  // Fonctions Edge de l'ancien MVP (jeton personnel nécessaire).
  if (process.env.SUPABASE_ACCESS_TOKEN && REF) {
    const mine = new Set(readdirSync(join(ROOT, "supabase/functions"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name));
    const deployed = (await management("GET", `/projects/${REF}/functions`)) ?? [];
    for (const f of deployed) {
      if (mine.has(f.slug)) continue;
      await management("DELETE", `/projects/${REF}/functions/${f.slug}`);
      console.log(`Fonction Edge supprimée : ${f.slug}`);
    }
  } else {
    console.log("Sans SUPABASE_ACCESS_TOKEN, les anciennes fonctions Edge n'ont pas été vérifiées.");
  }
}

// ---------------------------------------------------------------- base
async function migrate() {
  const files = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
  await withDb(async (db) => {
    const legacy = await db.query("select to_regclass('public.alert_preferences') is not null as old");
    if (legacy.rows[0].old) {
      throw new Error("L'ancien schéma du premier MVP est encore en place. Lancer d'abord : npm run deploy -- purge --oui");
    }
    // Même table que la CLI Supabase : `supabase db push` verra ces migrations comme appliquées.
    await db.query(`create schema if not exists supabase_migrations;
      create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)`);
    const { rows } = await db.query("select version from supabase_migrations.schema_migrations");
    const done = new Set(rows.map((r) => r.version));
    let applied = 0;
    for (const f of files) {
      const [version, ...rest] = f.replace(/\.sql$/, "").split("_");
      if (done.has(version)) continue;
      const sql = readFileSync(join(ROOT, "supabase/migrations", f), "utf8");
      process.stdout.write(`  ${f} … `);
      await db.query("begin");
      try {
        await db.query(sql);
        await db.query("insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3)", [version, rest.join("_"), [sql]]);
        await db.query("commit");
        applied++;
        console.log("ok");
      } catch (e) {
        await db.query("rollback");
        console.log("ÉCHEC");
        throw e;
      }
    }
    console.log(applied ? `${applied} migration(s) appliquée(s).` : "Base à jour.");
  });
}

// ---------------------------------------------------------------- authentification
async function auth() {
  if (!REF) throw new Error("VITE_SUPABASE_URL invalide");
  const template = readFileSync(join(ROOT, "supabase/templates/code-connexion.html"), "utf8");
  const site = process.env.APP_URL ?? "http://localhost:5173";
  const body = {
    site_url: site,
    uri_allow_list: [site, "http://localhost:5173", "http://localhost:4173"].filter((v, i, a) => a.indexOf(v) === i).join(","),
    external_email_enabled: true,
    disable_signup: false,
    mailer_otp_length: 6,
    mailer_otp_exp: 600,
    mailer_subjects_magic_link: "Ton code PréviÉnergie",
    mailer_templates_magic_link_content: template,
    mailer_subjects_confirmation: "Ton code PréviÉnergie",
    mailer_templates_confirmation_content: template,
  };
  // Service SMTP (Resend, Brevo…) : indispensable avant l'ouverture au public.
  if (process.env.SMTP_HOST) {
    Object.assign(body, {
      smtp_host: process.env.SMTP_HOST,
      smtp_port: process.env.SMTP_PORT ?? "587",
      smtp_user: need("SMTP_USER"),
      smtp_pass: need("SMTP_PASS"),
      smtp_admin_email: need("EMAIL_FROM"),
      smtp_sender_name: "PréviÉnergie",
      rate_limit_email_sent: 100,
    });
  } else {
    console.log("  Pas de SMTP_HOST : l'email intégré de Supabase reste actif (quelques emails par heure seulement).");
  }
  await management("PATCH", `/projects/${REF}/config/auth`, body);
  console.log("Authentification configurée : code à 6 chiffres, modèle d'email PréviÉnergie.");
}

// ---------------------------------------------------------------- secrets
const SECRET_NAMES = [
  "ANTHROPIC_API_KEY", "CLAUDE_MODEL", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT", "CRON_SECRET", "APP_URL", "APP_ORIGINS",
  "EMAIL_PROVIDER", "EMAIL_API_KEY", "EMAIL_FROM",
  "WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_TEMPLATE", "WHATSAPP_TEMPLATE_LANG", "WHATSAPP_API_VERSION",
  "SMS_PROVIDER", "ORANGE_CLIENT_ID", "ORANGE_CLIENT_SECRET", "ORANGE_SENDER", "ORANGE_SENDER_NAME",
  "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM", "TWILIO_MESSAGING_SERVICE_SID",
  "CINETPAY_API_KEY", "CINETPAY_SITE_ID",
];

function ensureCronSecret() {
  if (process.env.CRON_SECRET) return process.env.CRON_SECRET;
  const secret = randomBytes(32).toString("base64url");
  const file = join(ROOT, ".env.local");
  writeFileSync(file, `${readFileSync(file, "utf8").replace(/\n?$/, "\n")}CRON_SECRET=${secret}\n`);
  process.env.CRON_SECRET = secret;
  console.log("  CRON_SECRET généré et ajouté à .env.local.");
  return secret;
}

async function secrets() {
  if (!REF) throw new Error("VITE_SUPABASE_URL invalide");
  ensureCronSecret();
  const list = SECRET_NAMES.filter((n) => process.env[n]).map((name) => ({ name, value: process.env[name] }));
  if (process.env.VITE_VAPID_PUBLIC_KEY) list.push({ name: "VAPID_PUBLIC_KEY", value: process.env.VITE_VAPID_PUBLIC_KEY });
  await management("POST", `/projects/${REF}/secrets`, list);
  console.log(`${list.length} secret(s) envoyés : ${list.map((s) => s.name).join(", ")}`);
  const missing = ["ANTHROPIC_API_KEY", "APP_URL", "EMAIL_API_KEY", "CINETPAY_API_KEY"].filter((n) => !process.env[n]);
  if (missing.length) console.log(`  Encore absents : ${missing.join(", ")}.`);
}

// ---------------------------------------------------------------- fonctions
function functions() {
  if (!REF) throw new Error("VITE_SUPABASE_URL invalide");
  need("SUPABASE_ACCESS_TOKEN");
  const names = readdirSync(join(ROOT, "supabase/functions"), { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_") && existsSync(join(ROOT, "supabase/functions", d.name, "index.ts")))
    .map((d) => d.name);
  // --use-api : empaquetage côté Supabase, sans Docker.
  execFileSync("npx", ["-y", "supabase@latest", "functions", "deploy", ...names, "--project-ref", REF, "--use-api"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

// ---------------------------------------------------------------- tâche horaire
async function cron() {
  const secret = ensureCronSecret();
  const url = `${URL_}/functions/v1/alertes`;
  await withDb(async (db) => {
    await db.query("create extension if not exists pg_cron");
    await db.query("create extension if not exists pg_net");
    await db.query(`delete from vault.secrets where name = 'previenergie_cron_secret'`);
    await db.query(`select vault.create_secret($1, 'previenergie_cron_secret', 'En-tête x-cron-secret de la fonction alertes')`, [secret]);
    await db.query(`select cron.unschedule(jobid) from cron.job where jobname = 'previenergie-alertes'`);
    // Chaque heure pile : 18 h, 19 h et 21 h tombent sur un passage.
    await db.query(
      `select cron.schedule('previenergie-alertes', '0 * * * *', $cmd$
        select net.http_post(
          url := '${url}',
          headers := jsonb_build_object('content-type', 'application/json',
            'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'previenergie_cron_secret')),
          body := '{}'::jsonb,
          timeout_milliseconds := 120000)
      $cmd$)`,
    );
  });
  console.log("Tâche horaire « previenergie-alertes » programmée (chaque heure).");
}

// ---------------------------------------------------------------- administrateur
async function admin(email) {
  if (!email) throw new Error("Usage : npm run deploy -- admin prenom@exemple.com");
  await withDb(async (db) => {
    const { rowCount } = await db.query("update public.profiles set role = 'admin' where lower(email) = lower($1)", [email]);
    if (!rowCount) throw new Error(`Aucun compte pour ${email} : connecte-toi d'abord une fois à l'application.`);
    await db.query("insert into public.audit_log (action, target_type, details) values ('user.update', 'profile', $1)", [{ promoted: email, role: "admin", by: "script" }]);
  });
  console.log(`${email} est administrateur.`);
}

async function status() {
  await withDb(async (db) => {
    const m = await db.query("select version, name from supabase_migrations.schema_migrations order by version").catch(() => ({ rows: [] }));
    console.log(`Migrations : ${m.rows.map((r) => `${r.version}_${r.name}`).join(", ") || "aucune"}`);
    const c = await db.query(`select
      (select count(*) from public.profiles)::int profils,
      (select count(*) from public.meters)::int compteurs,
      (select count(*) from public.readings)::int releves,
      (select count(*) from public.profiles where role = 'admin')::int admins`).catch(() => null);
    if (c) console.log(c.rows[0]);
    const j = await db.query("select jobname, schedule, active from cron.job where jobname like 'previenergie%'").catch(() => ({ rows: [] }));
    console.log(`Tâches : ${j.rows.map((r) => `${r.jobname} (${r.schedule}${r.active ? "" : ", inactive"})`).join(", ") || "aucune"}`);
    const r = await db.query(`select status_code, created from net._http_response order by created desc limit 3`).catch(() => ({ rows: [] }));
    if (r.rows.length) console.log("Derniers appels de la tâche :", r.rows.map((x) => `${x.status_code} à ${x.created.toISOString()}`).join(" · "));
  });
}

const [step, arg] = process.argv.slice(2);
const steps = { purge, db: migrate, auth, secrets, functions, cron, admin: () => admin(arg), status };
try {
  if (step === "all") {
    for (const s of ["db", "auth", "secrets", "functions", "cron"]) {
      console.log(`\n== ${s}`);
      await steps[s]();
    }
  } else if (steps[step]) {
    await steps[step]();
  } else {
    console.log("Étapes : purge --oui, db, auth, secrets, functions, cron, admin <email>, status, all");
  }
} catch (e) {
  console.error(`\nErreur : ${e.message}`);
  process.exitCode = 1;
}
