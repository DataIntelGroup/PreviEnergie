// Génère une paire de clés VAPID (Web Push) et l'écrit dans .env.local si
// les variables y sont vides. La clé privée ne va que dans les secrets des
// fonctions Supabase, jamais dans l'application.
//   npm run vapid
import { generateKeyPairSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const jwkPub = publicKey.export({ format: "jwk" });
const jwkPriv = privateKey.export({ format: "jwk" });
const b64 = (s) => Buffer.from(s, "base64url");
// Clé publique au format « non compressé » : 0x04 || X || Y.
const pub = Buffer.concat([Buffer.from([4]), b64(jwkPub.x), b64(jwkPub.y)]).toString("base64url");
const priv = jwkPriv.d;

const file = ".env.local";
let env = existsSync(file) ? readFileSync(file, "utf8") : "";
const set = (key, value) => {
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(env)) {
    const current = env.match(re)[0].slice(key.length + 1).trim();
    if (current) return false;
    env = env.replace(re, `${key}=${value}`);
  } else {
    env += `${env.endsWith("\n") || !env ? "" : "\n"}${key}=${value}\n`;
  }
  return true;
};

const a = set("VITE_VAPID_PUBLIC_KEY", pub);
const b = set("VAPID_PRIVATE_KEY", priv);
if (a && b) {
  writeFileSync(file, env);
  console.log("Clés VAPID écrites dans .env.local (VITE_VAPID_PUBLIC_KEY et VAPID_PRIVATE_KEY).");
} else {
  console.log("Des clés VAPID existent déjà dans .env.local : rien n'a été changé.");
  console.log("Pour les remplacer, videz les deux variables puis relancez. Attention : les abonnements existants seront perdus.");
}
