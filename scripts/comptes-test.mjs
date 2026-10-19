// Comptes de test et codes de connexion, sans envoyer d'email.
//   npm run comptes:test
// Crée (ou reprend) testeur@previenergie.test et equipe@previenergie.test
// (rôle admin), puis affiche un code à 6 chiffres valable 10 minutes pour
// chacun. Sur /connexion : saisir l'email, puis « J'ai déjà un code ».
// Le domaine .test n'existe pas : aucun email ne peut partir vers ces comptes.
const URL_ = process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
  console.error("VITE_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont nécessaires dans .env.local");
  process.exit(1);
}
const headers = { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json" };

const ACCOUNTS = [
  { email: "testeur@previenergie.test", role: "user", first_name: "Awa", last_name: "Testeur", phone: "0700000101" },
  { email: "equipe@previenergie.test", role: "admin", first_name: "Équipe", last_name: "Test", phone: "0700000102" },
];

async function call(method, path, body) {
  const res = await fetch(`${URL_}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} : ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

for (const a of ACCOUNTS) {
  const list = await call("GET", `/auth/v1/admin/users?per_page=200`);
  let user = list.users.find((u) => u.email === a.email);
  if (!user) user = await call("POST", "/auth/v1/admin/users", { email: a.email, email_confirm: true, user_metadata: { source: "test" } });
  // Profil complet et rôle : le compte de test entre directement dans l'app.
  await call("PATCH", `/rest/v1/profiles?id=eq.${user.id}`, {
    first_name: a.first_name, last_name: a.last_name, phone: a.phone, role: a.role, source: "test",
  });
  const link = await call("POST", "/auth/v1/admin/generate_link", { type: "magiclink", email: a.email });
  const code = link.email_otp ?? link.properties?.email_otp;
  console.log(`${a.email.padEnd(28)} rôle ${a.role.padEnd(5)} code ${code}`);
}
console.log("\nCodes valables 10 minutes. Sur /connexion : email, puis « J'ai déjà un code ».");
