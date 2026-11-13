// Lecture locale d'un reçu ou d'une facture, sur le téléphone : texte d'un
// PDF (pdf.js), reconnaissance de caractères sur une image (Tesseract), ou
// SMS collé. Rien n'est envoyé à un serveur pour lire : c'est gratuit et la
// photo reste sur l'appareil. Les bibliothèques ne se chargent qu'au besoin.
import { type BillRead, parseBillText, parseMeterText, parseReceiptText, type ReceiptRead } from "@shared/lecture-recu.ts";
import type { Worker } from "tesseract.js";

export type ReadMethod = "pdf" | "image" | "texte";

export interface LocalRead {
  method: ReadMethod;
  text: string;
  /** Confiance de la reconnaissance, 0 à 100 (images seulement). */
  confidence: number | null;
}

let worker: Promise<Worker> | null = null;
let progressCb: ((p: number) => void) | null = null;

async function getWorker(): Promise<Worker> {
  worker ??= (async () => {
    const { createWorker } = await import("tesseract.js");
    // Modèle français téléchargé une fois, puis gardé par le navigateur.
    return createWorker("fra", 1, {
      logger: (m: { status: string; progress: number }) => {
        if (m.status === "recognizing text") progressCb?.(m.progress);
      },
    });
  })();
  try {
    return await worker;
  } catch (e) {
    worker = null;
    throw e;
  }
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image illisible."));
    };
    img.src = url;
  });
}

/**
 * Prépare l'image pour la reconnaissance : pleine résolution (pas la
 * version compressée pour le stockage), petites images agrandies, niveaux
 * de gris avec contraste étiré.
 */
async function prepare(file: Blob): Promise<HTMLCanvasElement> {
  const img = await loadImage(file);
  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = longest > 2600 ? 2600 / longest : longest < 1200 ? Math.min(3, 1600 / longest) : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Lecture impossible sur ce téléphone.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  let min = 255;
  let max = 0;
  for (let i = 0; i < px.length; i += 4) {
    const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    px[i] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const range = Math.max(1, max - min);
  for (let i = 0; i < px.length; i += 4) {
    const g = ((px[i] - min) * 255) / range;
    px[i] = px[i + 1] = px[i + 2] = g;
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

export async function readImage(file: Blob, onProgress?: (p: number) => void): Promise<LocalRead> {
  const w = await getWorker();
  progressCb = onProgress ?? null;
  try {
    const { data } = await w.recognize(await prepare(file));
    return { method: "image", text: data.text, confidence: data.confidence };
  } finally {
    progressCb = null;
  }
}

/** Noir et blanc par le seuil d'Otsu, éventuellement inversé (chiffres clairs sur fond sombre). */
function binarize(src: HTMLCanvasElement, invert: boolean): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0);
  const data = ctx.getImageData(0, 0, out.width, out.height);
  const px = data.data;
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < px.length; i += 4) hist[px[i]]++;
  const total = px.length / 4;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB || wB === total) continue;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / (total - wB);
    const between = wB * (total - wB) * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  for (let i = 0; i < px.length; i += 4) {
    const dark = px[i] <= threshold;
    px[i] = px[i + 1] = px[i + 2] = dark !== invert ? 0 : 255;
  }
  ctx.putImageData(data, 0, 0);
  return out;
}

/**
 * Valeur affichée par l'écran du compteur, lue sur le téléphone : chiffres
 * seulement, trois passes (photo, noir et blanc, inversée), on garde le
 * nombre le plus long. La lecture est toujours confirmée par l'abonné.
 */
export async function readMeter(file: Blob, onProgress?: (p: number) => void): Promise<{ value: number | null; confidence: number | null }> {
  const w = await getWorker();
  const canvas = await prepare(file);
  const variants = [canvas, binarize(canvas, false), binarize(canvas, true)];
  let best: { value: number; digits: number; confidence: number } | null = null;
  await w.setParameters({ tessedit_char_whitelist: "0123456789.,", tessedit_pageseg_mode: "6" as never });
  try {
    for (const [i, v] of variants.entries()) {
      progressCb = (p) => onProgress?.((i + p) / variants.length);
      const { data } = await w.recognize(v);
      const value = parseMeterText(data.text);
      if (value === null) continue;
      const digits = String(value).replace(/\D/g, "").length;
      if (!best || digits > best.digits || (digits === best.digits && data.confidence > best.confidence)) best = { value, digits, confidence: data.confidence };
    }
  } finally {
    progressCb = null;
    // Le lecteur sert aussi aux reçus : on remet les réglages par défaut.
    await w.setParameters({ tessedit_char_whitelist: "", tessedit_pageseg_mode: "3" as never });
  }
  return best ? { value: best.value, confidence: Math.round(best.confidence) / 100 } : { value: null, confidence: null };
}

export async function readPdf(file: Blob): Promise<LocalRead> {
  const { pdfToText } = await import("./pdf-text");
  return { method: "pdf", text: await pdfToText(file), confidence: null };
}

export function isPdf(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

export async function readFile(file: File, onProgress?: (p: number) => void): Promise<LocalRead> {
  return isPdf(file) ? readPdf(file) : readImage(file, onProgress);
}

export const readReceipt = (r: LocalRead): ReceiptRead => parseReceiptText(r.text);
export const readBill = (r: LocalRead): BillRead => parseBillText(r.text);
