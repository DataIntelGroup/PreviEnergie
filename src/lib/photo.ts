// Compression des photos avant envoi : moins de 500 Ko (exigence de
// performance), assez nettes pour que l'IA lise les chiffres.
const MAX_BYTES = 500 * 1024;
const MAX_SIDE = 1600;

export interface CompressedPhoto {
  blob: Blob;
  base64: string;
  width: number;
  height: number;
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
      reject(new Error("Photo illisible. Réessaie avec une autre photo."));
    };
    img.src = url;
  });
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Compression impossible"))), "image/jpeg", quality),
  );
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function compressPhoto(file: File): Promise<CompressedPhoto> {
  const img = await loadImage(file);
  let scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  for (let attempt = 0; attempt < 6; attempt++) {
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Compression impossible sur ce téléphone");
    ctx.drawImage(img, 0, 0, w, h);
    for (const q of [0.82, 0.7, 0.6]) {
      const blob = await toBlob(canvas, q);
      if (blob.size <= MAX_BYTES) return { blob, base64: await blobToBase64(blob), width: w, height: h };
    }
    scale *= 0.75;
  }
  throw new Error("Photo trop lourde, même compressée.");
}
