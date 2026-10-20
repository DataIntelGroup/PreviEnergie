import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Adresse publique du site, pour le manifeste.
const SITE_URL = (process.env.VITE_SITE_URL ?? "https://previenergie.vercel.app").replace(/\/$/, "");

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Moteur de prévision et règles partagés avec les fonctions serveur.
      "@shared": fileURLToPath(new URL("./supabase/functions/_shared", import.meta.url)),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["favicon.ico", "apple-touch-icon-180x180.png", "logo.svg"],
      manifest: {
        // Identité de l'app installée : ne plus jamais la changer, sinon les
        // navigateurs la verraient comme une autre application.
        id: "/app",
        name: "PréviÉnergie",
        short_name: "PréviÉnergie",
        description: "Suivi de ta consommation CIE et alerte avant la coupure. Service indépendant, non affilié à la CIE.",
        lang: "fr",
        dir: "ltr",
        start_url: "/app",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#fffaf5", // crème de la page d'accueil (écran de démarrage)
        theme_color: "#ea580c",
        categories: ["utilities", "lifestyle"],
        icons: [
          { src: "pwa-64x64.png", sizes: "64x64", type: "image/png", purpose: "any" },
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        // Appui long sur l'icône (Android, Windows) : les deux gestes du quotidien.
        shortcuts: [
          { name: "Nouveau relevé", short_name: "Relevé", url: "/app/releve", icons: [{ src: "pwa-192x192.png", sizes: "192x192" }] },
          { name: "Nouvelle recharge", short_name: "Recharge", url: "/app/recharge", icons: [{ src: "pwa-192x192.png", sizes: "192x192" }] },
        ],
        // Permet à Chrome de dire si l'app est déjà installée (getInstalledRelatedApps).
        related_applications: [{ platform: "webapp", url: `${SITE_URL}/manifest.webmanifest` }],
        prefer_related_applications: false,
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        // Lecteur de PDF (430 Ko + son worker de 1,2 Mo) : chargé seulement quand on importe un PDF.
        globIgnores: ["**/pdf-text-*.js", "**/pdf.worker*"],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: { target: "es2022", chunkSizeWarningLimit: 600 },
});
