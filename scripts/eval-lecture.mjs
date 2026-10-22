// Évalue la lecture locale (Tesseract + règles) sur les exemples privés de
// docs/prive/recus/ (jamais versionnés). N'affiche que les champs lus,
// jamais les noms ni les numéros de téléphone.
//   npm run eval:lecture
//   npm run eval:lecture -- <dossier> [chemin du modèle tessdata]
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { createWorker } from "tesseract.js";
import { parseBillText, parseReceiptText } from "../supabase/functions/_shared/lecture-recu.ts";

const ROOT = resolve(import.meta.dirname, "..");
const dir = resolve(process.argv[2] ?? join(ROOT, "docs/prive/recus"));
const langPath = process.argv[3]; // facultatif : dossier local contenant fra.traineddata.gz

async function pdfText(file) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), useSystemFonts: true }).promise;
  let text = "";
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    text += content.items.map((i) => ("str" in i ? i.str + (i.hasEOL ? "\n" : " ") : "")).join("") + "\n";
  }
  return text;
}

const files = readdirSync(dir).filter((f) => /\.(png|jpe?g|jfif|webp|pdf)$/i.test(f)).sort();
if (!files.length) {
  console.log(`Aucun exemple dans ${dir}`);
  process.exit(0);
}

const worker = await createWorker("fra", 1, langPath ? { langPath, cachePath: langPath, gzip: true } : {});
for (const f of files) {
  const path = join(dir, f);
  const t0 = Date.now();
  let text;
  let how;
  if (extname(f).toLowerCase() === ".pdf") {
    text = await pdfText(path);
    how = "texte du PDF";
  } else {
    const { data } = await worker.recognize(path);
    text = data.text;
    how = `reconnaissance, confiance ${Math.round(data.confidence)} %`;
  }
  const isBill = /facture d.electricite|releve compteur|total facture/i.test(text.normalize("NFD").replace(/[̀-ͯ]/g, ""));
  console.log(`\n=== ${f} (${how}, ${Date.now() - t0} ms)`);
  if (isBill) {
    const b = parseBillText(text);
    console.log(`facture : période ${b.periodStart} → ${b.periodEnd} · index ${b.indexStart} → ${b.indexEnd} · ${b.kwh} kWh · total ${b.amountFcfa} F · part fixe ${b.fixedFcfa} F · à payer avant ${b.dueDate} · ${b.found}/4 champs`);
  } else {
    const r = parseReceiptText(text);
    const c = r.code ? `${r.code.slice(0, 4)} … (${r.code.replace(/\D/g, "").length} chiffres)` : null;
    console.log(`${r.source} · ${r.kind} · montant ${r.amountFcfa} F · ${r.kwh} kWh · code ${c} · date ${r.date} · ${r.found}/4 champs`);
    if (r.breakdown.energie !== null) {
      console.log(`  détail : énergie ${r.breakdown.energie} · prime fixe ${r.breakdown.primeFixe} · RTI ${r.breakdown.rti} · RER ${r.breakdown.rer} · TEOM ${r.breakdown.teom} · branchement ${r.breakdown.branchement} · TVA ${r.breakdown.tva} → contrôle ${r.consistent ? "juste ✓" : "faux ✗"}`);
    }
  }
}
await worker.terminate();
