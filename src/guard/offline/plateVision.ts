/**
 * Image work for the plate reader — all on the phone, no network.
 *
 *   locatePlate   find the plate in a photo: the bright rectangle, about 2–5×
 *                 wider than tall, densest in vertical strokes (characters).
 *                 Integral images make the search over a few thousand candidate
 *                 boxes take a few milliseconds even on an old phone.
 *   cropForOcr    cut that box out of the full-resolution photo, scale it to a
 *                 height Tesseract likes (~180 px), stretch the contrast and
 *                 binarise it with Otsu's threshold — dark characters on white,
 *                 inverted automatically for light-on-dark code boxes.
 *
 * Why this matters: Tesseract reads a tight, clean crop of a plate far better
 * than a whole photo — a plate that is small in the frame (test plate 07) is
 * not read at all from the full photo, and is read from the crop.
 */

export function canvasOf(src: CanvasImageSource, w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

export function loadBitmap(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read the photo'));
    };
    img.src = url;
  });
}

function grey(c: HTMLCanvasElement) {
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const g = new Uint8ClampedArray(c.width * c.height);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) g[j] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
  return g;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
}

/** Find the most plate-like box. Coordinates are fractions (0–1) of the source image. */
export function locatePlate(src: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement, sw: number, sh: number): Box | null {
  const W = 360;
  const H = Math.max(40, Math.round((sh / sw) * W));
  const c = canvasOf(src, W, H);
  const g = grey(c);
  // Integral images: vertical-stroke edges, and brightness.
  const E = new Float64Array((W + 1) * (H + 1));
  const B = new Float64Array((W + 1) * (H + 1));
  let total = 0;
  for (let y = 0; y < H; y++) {
    let er = 0;
    let br = 0;
    for (let x = 0; x < W; x++) {
      const v = g[y * W + x];
      const e = x > 0 && x < W - 1 && Math.abs(g[y * W + x + 1] - g[y * W + x - 1]) > 48 ? 1 : 0;
      er += e;
      br += v;
      total += v;
      E[(y + 1) * (W + 1) + x + 1] = E[y * (W + 1) + x + 1] + er;
      B[(y + 1) * (W + 1) + x + 1] = B[y * (W + 1) + x + 1] + br;
    }
  }
  const mean = total / (W * H);
  const sum = (I: Float64Array, x: number, y: number, w: number, h: number) => I[(y + h) * (W + 1) + x + w] - I[y * (W + 1) + x + w] - I[(y + h) * (W + 1) + x] + I[y * (W + 1) + x];

  let best: Box | null = null;
  for (const hf of [0.06, 0.09, 0.13, 0.18, 0.25, 0.34, 0.45]) {
    const h = Math.round(H * hf);
    if (h < 8) continue;
    for (const ratio of [2.2, 3, 3.8, 4.6]) {
      const w = Math.round(h * ratio);
      if (w > W) continue;
      const step = Math.max(2, Math.round(h / 6));
      for (let y = 0; y + h <= H; y += step) {
        for (let x = 0; x + w <= W; x += step) {
          const area = w * h;
          const density = sum(E, x, y, w, h) / area;
          if (density < 0.05) continue;
          const bright = sum(B, x, y, w, h) / area;
          if (bright < mean * 0.9) continue; // plates are light
          // Edges must sit INSIDE the box, not around it: compare with the surrounding ring.
          const mx = Math.max(0, x - Math.round(w * 0.15));
          const my = Math.max(0, y - Math.round(h * 0.4));
          const mw = Math.min(W - mx, w + Math.round(w * 0.3));
          const mh = Math.min(H - my, h + Math.round(h * 0.8));
          const ring = (sum(E, mx, my, mw, mh) - sum(E, x, y, w, h)) / Math.max(1, mw * mh - area);
          const score = (density - ring * 0.7) * Math.pow(area, 0.35) * (bright / 255);
          if (!best || score > best.score) best = { x, y, w, h, score };
        }
      }
    }
  }
  if (!best || best.score <= 0) return null;
  return { x: best.x / W, y: best.y / H, w: best.w / W, h: best.h / H, score: best.score };
}

function otsu(g: Uint8ClampedArray) {
  const hist = new Array(256).fill(0);
  for (const v of g) hist[v]++;
  const n = g.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      thr = t;
    }
  }
  return thr;
}

/**
 * Crop a box (fractions of the source) with a margin, scale to ~180 px high,
 * stretch contrast and binarise. `binarise: false` keeps the grey version
 * (a second opinion for the voter).
 */
export function cropForOcr(src: CanvasImageSource, sw: number, sh: number, box: { x: number; y: number; w: number; h: number }, binarise = true) {
  const mx = box.w * 0.06;
  const my = box.h * 0.2; // generous: a slightly tilted plate must not lose the tops of its digits
  const x = Math.max(0, (box.x - mx) * sw);
  const y = Math.max(0, (box.y - my) * sh);
  const w = Math.min(sw - x, (box.w + mx * 2) * sw);
  const h = Math.min(sh - y, (box.h + my * 2) * sh);
  const scale = 180 / Math.max(1, h);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const g = grey(c);
  let lo = 255;
  let hi = 0;
  for (const v of g) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < g.length; i++) g[i] = ((g[i] - lo) * 255) / span;
  if (binarise) {
    const t = otsu(g);
    let dark = 0;
    for (let i = 0; i < g.length; i++) {
      g[i] = g[i] > t ? 255 : 0;
      if (!g[i]) dark++;
    }
    // Mostly dark → light characters on a dark field: invert so text is always dark on white.
    if (dark > g.length * 0.6) for (let i = 0; i < g.length; i++) g[i] = 255 - g[i];
  }
  for (let i = 0, j = 0; j < g.length; i += 4, j++) {
    img.data[i] = img.data[i + 1] = img.data[i + 2] = g[j];
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
