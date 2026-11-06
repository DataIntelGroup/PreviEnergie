// Définit le mot de passe d'un compte de l'équipe (admin ou support) ou d'un
// compte de test, pour se connecter sans attendre d'email : en ligne sur
// /connexion?mdp, ou en local sur /connexion. Le mot de passe est saisi deux fois, masqué, et
// n'est ni affiché ni enregistré : il part directement chez Supabase.
//   npm run mot-de-passe -- prenom@exemple.com
import { createInterface } from "node:readline";

const URL_ = process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = (process.argv[2] ?? "").trim().toLowerCase();
if (!URL_ || !KEY) {
  console.error("VITE_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont nécessaires dans .env.local");
  process.exit(1);
}
if (!email) {
  console.error("Indique l'email du compte : npm run mot-de-passe -- prenom@exemple.com");
  process.exit(1);
}
if (!process.stdin.isTTY) {
  console.error("Lance cette commande dans un terminal : le mot de passe se tape au clavier.");
  process.exit(1);
}
const headers = { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json" };

async function call(method, path, body) {
  const res = await fetch(`${URL_}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

/** Saisie masquée : rien ne s'affiche pendant la frappe. */
function ask(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    rl._writeToOutput = (s) => {
      if (!muted || s.includes("\n")) process.stdout.write(muted ? "\n" : s);
    };
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
    muted = true;
  });
}

// Pas de process.exit après une requête : sous Windows, il fait planter Node.
function fail(message) {
  if (message) console.error(message);
  process.exitCode = 1;
}

async function main() {
  const [profile] = await call("GET", `/rest/v1/profiles?select=id,role,first_name&email=eq.${encodeURIComponent(email)}`);
  if (!profile) {
    return fail(`Aucun compte pour ${email}.`);
  }
  // Équipe, ou compte de test (domaines .test, qui ne reçoivent jamais d'email).
  const testAccount = email.endsWith("@previenergie.test") || email.endsWith("@demo.previenergie.test");
  if (profile.role !== "admin" && profile.role !== "support" && !testAccount) {
    return fail("Réservé à l'équipe (admin ou support) et aux comptes de test : les vrais clients se connectent avec un code par email.");
  }

  const first = await ask(`Nouveau mot de passe pour ${email} (12 caractères au moins) : `);
  if (first.length < 12) {
    return fail("Trop court : 12 caractères au moins. Rien n'a été changé.");
  }
  const second = await ask("Retape-le : ");
  if (first !== second) {
    return fail("Les deux saisies sont différentes. Rien n'a été changé.");
  }
  await call("PUT", `/auth/v1/admin/users/${profile.id}`, { password: first });
  console.log(`Mot de passe enregistré pour ${email} (${profile.role}).`);
  console.log("Connexion : https://previenergie.vercel.app/connexion?mdp (ou en local, http://localhost:5173/connexion).");
}

await main();
