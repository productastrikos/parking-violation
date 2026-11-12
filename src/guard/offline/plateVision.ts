/**
 * The DOM side of the plate reader: photo → grey pixels, grey pixels → canvas
 * for Tesseract. All the image logic lives in plateCore.ts (pure, testable).
 */
import { greyFromRgba, type Grey } from './plateCore';

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

/** Grey pixels of an image / canvas / video frame, scaled so the long side is ≤ maxSide. */
export function greyOf(src: CanvasImageSource, sw: number, sh: number, maxSide = 1600): Grey {
  const k = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * k));
  const h = Math.max(1, Math.round(sh * k));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  return greyFromRgba(ctx.getImageData(0, 0, w, h).data, w, h);
}

export function greyToCanvas(g: Grey): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = g.w;
  c.height = g.h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.createImageData(g.w, g.h);
  for (let i = 0, j = 0; j < g.d.length; i += 4, j++) {
    img.data[i] = img.data[i + 1] = img.data[i + 2] = g.d[j];
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
