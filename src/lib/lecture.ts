// Lecture locale d'un reçu ou d'une facture, sur le téléphone : texte d'un
// PDF (pdf.js), reconnaissance de caractères sur une image (Tesseract), ou
// SMS collé. Rien n'est envoyé à un serveur pour lire : c'est gratuit et la
// photo reste sur l'appareil. Les bibliothèques ne se chargent qu'au besoin.
import { type BillRead, parseBillText, parseReceiptText, type ReceiptRead } from "@shared/lecture-recu.ts";
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
