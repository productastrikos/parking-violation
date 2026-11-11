/**
 * Turn a camera photo (often 4–12 MB) into what is worth storing and sending.
 *
 *   evidence  ≤1600 px on the long edge, JPEG q0.78 → ~200–350 KB. Enough to
 *             read a plate and see the context; small enough that a phone
 *             holds hundreds offline and one bar of signal can upload them.
 *   thumb     160 px data URL kept on the record for lists (survives sync).
 *
 * The capture time, place and guard are stamped onto the vehicle photo, the
 * way enforcement cameras do, so the evidence carries its context even when
 * it is looked at outside the system.
 *
 * Orientation: every browser this app supports (iOS 13.4+, Chrome 81+) applies
 * the photo's EXIF rotation when drawing an <img>, so portrait shots stay
 * upright without parsing EXIF here.
 */

export interface Processed {
  buf: ArrayBuffer;
  type: string;
  thumb: string;
  previewUrl: string; // object URL for the form preview; revoke when done
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
      reject(new Error('This photo could not be read — try taking it again'));
    };
    img.src = url;
  });
}

function canvasFor(img: HTMLImageElement, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);
  return { c, ctx, w, h };
}

const toBlob = (c: HTMLCanvasElement, q: number) =>
  new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode photo'))), 'image/jpeg', q));

export async function processPhoto(file: Blob, stamp?: string[]): Promise<Processed> {
  const img = await loadImage(file);
  const { c, ctx, w, h } = canvasFor(img, 1600);

  if (stamp?.length) {
    const fs = Math.max(14, Math.round(w / 42));
    const pad = Math.round(fs * 0.6);
    const lineH = Math.round(fs * 1.3);
    const boxH = pad * 2 + lineH * stamp.length;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, h - boxH, w, boxH);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `600 ${fs}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    ctx.textBaseline = 'top';
    stamp.forEach((line, i) => ctx.fillText(line, pad, h - boxH + pad + i * lineH, w - pad * 2));
  }

  const blob = await toBlob(c, 0.78);
  const t = canvasFor(img, 160);
  const thumb = t.c.toDataURL('image/jpeg', 0.6);
  return { buf: await blob.arrayBuffer(), type: 'image/jpeg', thumb, previewUrl: URL.createObjectURL(blob), width: w, height: h };
}

/** A grey, contrast-stretched copy for the plate reader — Tesseract reads that far better than a raw colour photo. */
export async function ocrCanvas(file: Blob): Promise<HTMLCanvasElement> {
  const img = await loadImage(file);
  const { c, ctx, w, h } = canvasFor(img, 1400);
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  let lo = 255;
  let hi = 0;
  const grey = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const g = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
    grey[j] = g;
    if (g < lo) lo = g;
    if (g > hi) hi = g;
  }
  const span = Math.max(1, hi - lo);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const v = Math.round(((grey[j] - lo) * 255) / span);
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(data, 0, 0);
  return c;
}
