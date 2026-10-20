// Texte d'un PDF (reçu Orange Money, facture téléchargée…) : il est déjà
// dans le fichier, pas besoin de reconnaissance de caractères.
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

export async function pdfToText(file: Blob): Promise<string> {
  const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  let text = "";
  for (let p = 1; p <= Math.min(doc.numPages, 4); p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    for (const item of content.items) {
      if ("str" in item) text += item.str + (item.hasEOL ? "\n" : " ");
    }
    text += "\n";
  }
  await task.destroy();
  return text;
}
