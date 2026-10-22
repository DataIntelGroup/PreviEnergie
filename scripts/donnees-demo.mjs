// Données de démonstration : 24 clients fictifs avec compteurs, relevés,
// recharges, factures, paiements, alertes et lectures IA, pour voir
// l'application et le back-office remplis comme après deux mois de service.
//
//   npm run demo            supprime les anciennes données de démo puis recrée tout
//   npm run demo -- vider   supprime seulement
//
// Tout est repérable et rien d'autre n'est touché : comptes en
// @demo.previenergie.test (le domaine .test n'existe pas, aucun message ne
// peut partir), paiements « DEMO-… », entrées du journal marquées demo.
// Les mêmes données sont recréées à chaque fois (générateur à graine fixe),
// recalées sur la date du jour.
import { randomUUID } from "node:crypto";

const URL_ = process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
  console.error("VITE_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont nécessaires dans .env.local");
  process.exit(1);
}
const DOMAIN = "@demo.previenergie.test";
const VITRINE = `aya.kouassi${DOMAIN}`;
const headers = { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json" };

async function call(method, path, body, extra = {}) {
  const res = await fetch(`${URL_}${path}`, { method, headers: { ...headers, ...extra }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path.split("?")[0]} : ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
const insert = async (table, rows) => {
  for (let i = 0; i < rows.length; i += 500) {
    await call("POST", `/rest/v1/${table}`, rows.slice(i, i + 500), { prefer: "return=minimal" });
  }
};

async function demoUsers() {
  const out = [];
  for (let page = 1; ; page++) {
    const { users } = await call("GET", `/auth/v1/admin/users?per_page=1000&page=${page}`);
    out.push(...users.filter((u) => u.email?.endsWith(DOMAIN)));
    if (users.length < 1000) return out;
  }
}

async function vider() {
  const users = await demoUsers();
  const ids = users.map((u) => u.id);
  // Paiements et lectures IA survivent à la suppression d'un compte
  // (user_id mis à NULL) : on les retire d'abord.
  for (let i = 0; i < ids.length; i += 50) {
    const list = `(${ids.slice(i, i + 50).join(",")})`;
    await call("DELETE", `/rest/v1/payments?user_id=in.${list}`);
    await call("DELETE", `/rest/v1/ai_reads?user_id=in.${list}`);
  }
  await call("DELETE", `/rest/v1/payments?transaction_id=like.DEMO-*`);
  await call("DELETE", `/rest/v1/audit_log?details->>demo=eq.true`);
  for (const u of users) await call("DELETE", `/auth/v1/admin/users/${u.id}`);
  console.log(`Données de démo supprimées : ${users.length} comptes.`);
}

// ---------------------------------------------------------------- générateur

let seed = 20261022;
function rnd() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (a, b) => a + rnd() * (b - a);
const int = (a, b) => Math.floor(between(a, b + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const weighted = (pairs) => {
  let x = rnd() * pairs.reduce((s, [, w]) => s + w, 0);
  for (const [v, w] of pairs) if ((x -= w) <= 0) return v;
  return pairs[0][0];
};
const r2 = (n) => Math.round(n * 100) / 100;

const DAY = 86_400_000;
const HOUR = 3_600_000;
const NOW = Date.now();
const today0 = Math.floor(NOW / DAY) * DAY; // minuit à Abidjan (UTC+0)
const iso = (ms) => new Date(ms).toISOString();
const date = (ms) => iso(ms).slice(0, 10);

const PEOPLE = [
  ["Aya", "Kouassi", "Cocody"], ["Koffi", "N'Guessan", "Yopougon"], ["Mariam", "Traoré", "Abobo"], ["Yao", "Konan", "Bouaké"],
  ["Adjoua", "Kouamé", "Marcory"], ["Ibrahim", "Coulibaly", "Adjamé"], ["Fatou", "Diabaté", "Koumassi"], ["Jean-Marc", "Brou", "Cocody"],
  ["Awa", "Ouattara", "Yopougon"], ["Serge", "Kouadio", "Plateau"], ["Nadège", "Yapi", "Bingerville"], ["Moussa", "Bamba", "Abobo"],
  ["Christelle", "Aka", "Marcory"], ["Didier", "Gnagne", "Port-Bouët"], ["Salimata", "Koné", "Korhogo"], ["Hervé", "Tanoh", "Treichville"],
  ["Rokia", "Sanogo", "Yopougon"], ["Patrick", "Assi", "Cocody"], ["Bintou", "Cissé", "Adjamé"], ["Arnaud", "Ehui", "Songon"],
  ["Prisca", "Kacou", "Yamoussoukro"], ["Lassina", "Touré", "San-Pédro"], ["Grâce", "N'Dri", "Koumassi"], ["Boris", "Zadi", "Daloa"],
];
const SOURCES = [["Facebook", 7], ["Bouche-à-oreille", 6], ["WhatsApp", 5], ["TikTok", 3], ["Affiche", 2], [null, 2]];
const PLANS = { essentiel: [1000, 2], famille_pro: [2500, 5], entreprise: [5000, 10] };
const METHODS = [["wave", 45], ["orange_money", 30], ["mtn_momo", 15], ["moov_money", 10]];
const HOMES = ["Maison", "Appartement", "Studio", "Maison de maman", "Villa"];
const SHOPS = ["Boutique", "Magasin", "Atelier", "Salon de coiffure", "Restaurant", "Dépôt", "Bureau", "Cave"];
const MODEL = "claude-opus-5-5";

const slug = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
const code20 = () => Array.from({ length: 5 }, () => String(int(0, 9999)).padStart(4, "0")).join(" ");
const meterNumber = () => String(int(10_000_000, 99_999_999)) + String(int(100, 999));

/** Scénario d'un client : inscription, offre, paiements, période d'activité. */
function scenario(i) {
  const vitrine = i === 0;
  // Jours depuis l'inscription : plus d'inscrits récents, comme un service qui démarre.
  const signup = vitrine ? 52 : 1 + Math.floor(74 * rnd() ** 1.5);
  const start = today0 - signup * DAY + int(8, 20) * HOUR;
  let plan = null;
  let churned = false;
  if (vitrine) plan = "famille_pro";
  else if (signup >= 14 && rnd() < 0.75) {
    plan = weighted([["essentiel", 50], ["famille_pro", 35], ["entreprise", 15]]);
    churned = rnd() < 0.1;
  }
  // Paiements mensuels à partir de la fin de l'essai.
  const payments = [];
  let accessEnd = start + 14 * DAY; // fin d'essai
  if (plan) {
    const method = weighted(METHODS);
    let p = start + int(12, 14) * DAY + int(1, 10) * HOUR;
    if (p > NOW) p = NOW - 2 * HOUR; // inscrit il y a tout juste 14 jours : a payé aujourd'hui
    for (;;) {
      if (rnd() < 0.12) payments.push({ at: p - 2 * HOUR, status: "refused", method: weighted(METHODS) });
      payments.push({ at: p, status: "accepted", method });
      accessEnd = p + 30 * DAY;
      const next = accessEnd - int(0, 2) * DAY;
      if (next > NOW || (churned && payments.length >= 1)) break;
      p = next;
    }
  }
  const expired = accessEnd < NOW;
  // Les clients actifs relèvent jusqu'à aujourd'hui ; les autres arrêtent peu après la fin de leur accès.
  const activeUntil = expired ? Math.min(NOW, accessEnd + int(0, 4) * DAY) : NOW - int(0, 30) * 60_000;
  const maxMeters = plan ? PLANS[plan][1] : 1;
  const nMeters = vitrine ? 3 : plan === "entreprise" ? int(3, 6) : plan === "famille_pro" ? int(2, 3) : plan === "essentiel" ? int(1, 2) : 1;
  return { signup, start, plan, payments, accessEnd, expired, activeUntil, nMeters: Math.min(nMeters, maxMeters), vitrine };
}

/** Compteur prépayé : solde qui baisse, recharges, relevés, alertes, coupures. */
function simulatePrepaid(m, u, s, out) {
  const avg = m.avg;
  const ppk = between(58, 105); // FCFA par kWh, taxes comprises
  const habit = between(0.5, 2.6); // le client recharge quand il reste ~habit jours
  const diligence = u.vitrine ? 0.85 : between(0.45, 0.95); // probabilité de relever un jour donné
  let balance = between(avg * 4, avg * 11);
  let cycle = "initial";
  let sent = new Set();
  let alerted = false;
  let cut = false;
  let forgets = false;
  let lastReading = -Infinity;
  let lastReminder = -Infinity;
  const days = Math.ceil((s.activeUntil - m.start) / DAY);

  const reading = (at, value) => {
    if (at > s.activeUntil || at > NOW) return;
    const photo = rnd() < 0.74;
    const failed = photo && rnd() < 0.08;
    const v = r2(Math.max(0, value));
    out.readings.push({ id: randomUUID(), meter_id: m.id, user_id: u.id, taken_at: iso(at), value: v,
      source: photo && !failed ? "photo" : "manuel", photo_path: null,
      ai_value: photo && !failed ? v : null, ai_confidence: photo && !failed ? r2(between(0.86, 0.99)) : null, created_at: iso(at + int(1, 40) * 1000) });
    if (photo) out.aiReads.push({ user_id: u.id, kind: "compteur", success: !failed, confidence: failed ? null : r2(between(0.86, 0.99)), cost_fcfa: 6, model: MODEL, created_at: iso(at) });
    lastReading = at;
  };
  const alert = (type, at, text) => {
    if (sent.has(type) || at > NOW || at > s.activeUntil) return;
    sent.add(type);
    alerted = true;
    for (const channel of u.channels) {
      out.alerts.push({ user_id: u.id, meter_id: m.id, type, channel, cycle_key: cycle, status: "sent", cost_fcfa: channel === "email" ? 0.5 : 0, message: text, sent_at: iso(at) });
    }
  };

  reading(m.start + HOUR, balance);
  for (let d = 0; d <= days; d++) {
    const day0 = Math.floor(m.start / DAY) * DAY + d * DAY;
    const weekend = [0, 6].includes(new Date(day0).getUTCDay());
    const use = avg * between(0.78, 1.25) * (weekend ? (m.shop ? 0.6 : 1.2) : 1);
    const remainingDays = balance / avg;

    // Recharge du jour : à son seuil habituel. Une fois sur dix environ, le
    // client oublie malgré les alertes : le compteur se coupe, il recharge le lendemain.
    let rechargeAt = null;
    if (remainingDays <= habit || balance - use <= 0) {
      if (forgets && balance - use > 0) rechargeAt = null;
      else if (forgets) forgets = false; // coupé aujourd'hui, recharge demain
      else rechargeAt = day0 + int(8, 21) * HOUR + int(0, 59) * 60_000;
    }
    const startBalance = balance;
    const readHour = int(6, 22);
    const readAt = day0 + readHour * HOUR + int(0, 59) * 60_000;
    const levelAt = (h) => Math.max(0, startBalance - (use * h) / 24);

    if (rechargeAt && rechargeAt <= s.activeUntil && rechargeAt <= NOW) {
      const h = (rechargeAt - day0) / HOUR;
      const target = avg * between(9, 26) * ppk;
      const amount = Math.max(2000, Math.round(target / 1000) * 1000);
      const kwh = r2(amount / ppk);
      const id = randomUUID();
      // Après une alerte, le client dit s'il a été coupé (BF-13).
      if (alerted && rnd() < 0.75) out.feedback.push({ user_id: u.id, meter_id: m.id, cycle_key: cycle, was_cut: cut, created_at: iso(rechargeAt + 5 * 60_000) });
      out.recharges.push({ id, meter_id: m.id, user_id: u.id, purchased_at: iso(rechargeAt), kwh, amount_fcfa: amount, code: code20(),
        payment_method: weighted(METHODS), source: weighted([["photo", 40], ["sms", 30], ["manuel", 30]]), photo_path: null, created_at: iso(rechargeAt + 60_000) });
      balance = levelAt(h) + kwh - (use * (24 - h)) / 24;
      cycle = id;
      sent = new Set();
      alerted = false;
      cut = false;
      forgets = rnd() < 0.12;
      // Relevé juste après avoir tapé le code, la plupart du temps.
      if (rnd() < 0.7) reading(rechargeAt + int(5, 50) * 60_000, levelAt(h) + kwh);
    } else {
      if (startBalance - use <= 0) cut = true;
      balance = Math.max(0, startBalance - use);
    }

    if (rnd() < diligence && (!rechargeAt || Math.abs(readAt - rechargeAt) > 3 * HOUR)) {
      const after = rechargeAt && readAt > rechargeAt;
      reading(readAt, after ? balance + (use * (24 - readHour)) / 24 : levelAt(readHour));
    }

    // Alertes de 18 h selon les jours restants (BF-16), rappel de relevé à 19 h (BF-17).
    const left = (rechargeAt ? balance + (use * 6) / 24 : levelAt(18)) / avg;
    const at18 = day0 + 18 * HOUR;
    if (left <= 1) {
      alert("veille", at18, `${m.name} : coupure probable demain. Recharge ce soir si tu peux.`);
      if (rnd() < 0.5) alert("veille_rappel", at18 + 3 * HOUR, `${m.name} : rappel, ton courant s'épuise cette nuit.`);
    } else if (left <= 2) alert("niveau_j2", at18, `${m.name} : environ 2 jours de courant restants.`);
    else if (left <= 5) alert("niveau_j5", at18, `${m.name} : environ 5 jours de courant restants. Pense à recharger.`);
    const at19 = day0 + 19 * HOUR;
    if (at19 - lastReading > 48 * HOUR && at19 - lastReminder > 48 * HOUR && at19 <= Math.min(NOW, s.activeUntil)) {
      lastReminder = at19;
      for (const channel of u.channels) {
        out.alerts.push({ user_id: u.id, meter_id: m.id, type: "releve", channel, cycle_key: `${cycle}:releve:${date(at19)}`, status: "sent",
          cost_fcfa: channel === "email" ? 0.5 : 0, message: `${m.name} : fais un relevé pour garder une prévision juste.`, sent_at: iso(at19) });
      }
    }
  }
}

/** Compteur postpayé : index qui monte, relevés espacés, factures bimestrielles. */
function simulatePostpaid(m, u, s, out) {
  let index = int(3000, 42000);
  const ppk = between(78, 96);
  const fixed = int(25, 70) * 100;
  const daily = [];
  const days = Math.ceil((s.activeUntil - m.start) / DAY);
  // Factures : la période commence 60 jours avant l'inscription pour en avoir dès le départ.
  const billStart = m.start - 60 * DAY;
  let idx = index - m.avg * 60;
  for (let d = -60; d <= days; d++) {
    const use = m.avg * between(0.8, 1.2);
    daily.push({ day0: Math.floor(m.start / DAY) * DAY + d * DAY, before: idx });
    idx += use;
  }
  index = daily.find((x) => x.day0 >= Math.floor(m.start / DAY) * DAY).before;
  for (const x of daily) {
    if (x.day0 < Math.floor(m.start / DAY) * DAY || x.day0 > s.activeUntil) continue;
    if (rnd() < 0.3 || x === daily[60]) {
      const at = x.day0 + int(7, 20) * HOUR;
      if (at > NOW) continue;
      const photo = rnd() < 0.7;
      out.readings.push({ id: randomUUID(), meter_id: m.id, user_id: u.id, taken_at: iso(at), value: r2(x.before), source: photo ? "photo" : "manuel",
        photo_path: null, ai_value: photo ? r2(x.before) : null, ai_confidence: photo ? r2(between(0.88, 0.99)) : null, created_at: iso(at) });
      if (photo) out.aiReads.push({ user_id: u.id, kind: "compteur", success: true, confidence: r2(between(0.88, 0.99)), cost_fcfa: 6, model: MODEL, created_at: iso(at) });
    }
  }
  for (let p = Math.floor(billStart / DAY) * DAY; p + 60 * DAY < Math.min(NOW - 6 * DAY, s.activeUntil); p += 60 * DAY) {
    const a = daily.find((x) => x.day0 >= p);
    const b = daily.find((x) => x.day0 >= p + 60 * DAY);
    if (!a || !b) break;
    const kwh = r2(b.before - a.before);
    const posted = p + 60 * DAY + int(3, 6) * DAY;
    out.bills.push({ meter_id: m.id, user_id: u.id, period_start: date(p), period_end: date(p + 60 * DAY), index_start: r2(a.before), index_end: r2(b.before),
      kwh, amount_fcfa: Math.round(kwh * ppk + fixed), fixed_fcfa: fixed, due_date: date(p + 80 * DAY), source: rnd() < 0.6 ? "photo" : "manuel", photo_path: null, created_at: iso(posted) });
  }
}

async function remplir() {
  await vider();
  const admin = (await call("GET", `/rest/v1/profiles?select=id&email=eq.equipe@previenergie.test`))[0] ?? null;
  const out = { meters: [], readings: [], recharges: [], bills: [], alerts: [], aiReads: [], feedback: [], payments: [], audit: [], shares: [] };
  const users = [];

  for (let i = 0; i < PEOPLE.length; i++) {
    const [first, last, commune] = PEOPLE[i];
    const s = scenario(i);
    const email = i === 0 ? VITRINE : `${slug(first)}.${slug(last)}${DOMAIN}`;
    const source = i === 0 ? "Facebook" : weighted(SOURCES);
    const created = await call("POST", "/auth/v1/admin/users", { email, email_confirm: true, user_metadata: { source: source ?? "", demo: true } });
    const u = { id: created.id, email, first, last, s, channels: rnd() < 0.8 ? ["push", "email"] : ["push"], vitrine: s.vitrine };
    users.push(u);

    // Offre large le temps de créer les compteurs (le nombre est limité par l'offre), puis état réel.
    await call("PATCH", `/rest/v1/profiles?id=eq.${u.id}`, { plan_code: "entreprise", plan_expires_at: null });
    const homes = [...HOMES].sort(() => rnd() - 0.5);
    const shops = [...SHOPS].sort(() => rnd() - 0.5);
    for (let k = 0; k < s.nMeters; k++) {
      const shop = u.vitrine ? k > 0 : s.plan === "entreprise" ? true : k > 0;
      const postpaid = u.vitrine ? k === 2 : rnd() < (s.plan === "entreprise" ? 0.35 : 0.15);
      const name = u.vitrine ? ["Maison", "Boutique", "Bureau"][k] : shop ? shops[k] : homes[k];
      const start = s.start + k * int(0, 3) * DAY;
      const m = { id: randomUUID(), user_id: u.id, name, kind: postpaid ? "postpaid" : "prepaid", number: meterNumber(),
        created_at: iso(start), start, shop, avg: u.vitrine ? [7.5, 11, 18][k] : shop ? between(6, 22) : between(3, 13) };
      out.meters.push(m);
    }
    const mine = out.meters.filter((x) => x.user_id === u.id);
    await insert("meters", mine.map(({ start, shop, avg, ...m }) => m));
    for (const m of mine) (m.kind === "prepaid" ? simulatePrepaid : simulatePostpaid)(m, u, s, out);

    // Paiements CinetPay (BF-22) : vérifiés, avec la période payée.
    let lastAccepted = null;
    for (const p of s.payments) {
      const row = { id: randomUUID(), user_id: u.id, plan_code: s.plan, amount_fcfa: PLANS[s.plan][0], transaction_id: `DEMO-${randomUUID().slice(0, 13)}`,
        status: p.status, method: p.method, period_start: p.status === "accepted" ? iso(p.at) : null, period_end: p.status === "accepted" ? iso(p.at + 30 * DAY) : null,
        raw: { demo: true }, created_at: iso(p.at - 3 * 60_000), verified_at: iso(p.at) };
      out.payments.push(row);
      if (p.status === "accepted") lastAccepted = p;
    }
    const lastActivity = Math.max(s.start, ...out.readings.filter((r) => r.user_id === u.id).map((r) => Date.parse(r.taken_at)));
    await call("PATCH", `/rest/v1/profiles?id=eq.${u.id}`, {
      first_name: first, last_name: last, phone: `${pick(["01", "05", "07"])}000003${String(i).padStart(2, "0")}`, commune,
      plan_code: s.plan ?? "gratuit", plan_expires_at: lastAccepted ? iso(lastAccepted.at + 30 * DAY) : null,
      trial_ends_at: iso(s.start + 14 * DAY), channels: u.channels, created_at: iso(s.start), last_seen_at: iso(lastActivity),
    });
  }

  // Partage (BF-15) : la boutique d'Aya, suivie par Koffi.
  const aya = users[0];
  const koffi = users[1];
  const boutique = out.meters.find((m) => m.user_id === aya.id && m.name === "Boutique");
  out.shares.push({ meter_id: boutique.id, owner_id: aya.id, owner_name: "Aya Kouassi", email: koffi.email, member_id: koffi.id, role: "contributeur",
    alerts: true, status: "accepted", created_at: iso(aya.s.start + 3 * DAY), accepted_at: iso(aya.s.start + 3 * DAY + 2 * HOUR) });

  // Journal d'audit (BF-32) : quelques gestes de l'équipe ces deux derniers
  // jours (le journal s'affiche dans l'ordre d'ajout, donc dates croissantes).
  if (admin) {
    const picked = users.filter((x) => x.s.plan).slice(0, 6);
    for (const [k, u] of picked.entries()) {
      out.audit.push({ actor_id: admin.id, action: "user.update", target_type: "profile", target_id: u.id, created_at: iso(NOW - (picked.length - k) * 5 * HOUR),
        details: { demo: true, before: { plan: "gratuit", expires: null, role: "user", suspended: false }, after: { plan: u.s.plan, expires: null, role: "user", suspended: false } } });
    }
  }

  await insert("readings", out.readings);
  await insert("recharges", out.recharges);
  await insert("bills", out.bills);
  await insert("alerts", out.alerts);
  await insert("ai_reads", out.aiReads);
  await insert("cutoff_feedback", out.feedback);
  await insert("payments", out.payments);
  await insert("meter_shares", out.shares);
  if (out.audit.length) await insert("audit_log", out.audit);

  const paying = users.filter((u) => u.s.plan && !u.s.expired).length;
  console.log(`Clients de démo : ${users.length} (${paying} abonnés actifs, ${users.filter((u) => !u.s.plan && !u.s.expired).length} en essai, ${users.filter((u) => u.s.expired).length} en lecture seule)`);
  console.log(`Compteurs ${out.meters.length} · relevés ${out.readings.length} · recharges ${out.recharges.length} · factures ${out.bills.length}`);
  console.log(`Alertes ${out.alerts.length} · lectures IA ${out.aiReads.length} · réponses « coupé ? » ${out.feedback.length} · paiements ${out.payments.length}`);
  console.log(`\nCompte vitrine côté client : ${VITRINE} (Famille / Pro, 3 compteurs dont un postpayé, une boutique partagée).`);
  console.log("Code de connexion : npm run comptes:test");
}

if (process.argv[2] === "vider") await vider();
else await remplir();
