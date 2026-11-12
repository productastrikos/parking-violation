/**
 * Read the number plate — ON THE PHONE, OFFLINE.
 *
 * Tesseract.js (OCR in WebAssembly) runs inside the app. Its worker, engine and
 * English model are self-hosted under /ocr/ and precached by the service
 * worker, so this works with no signal, on Android and iPhone.
 *
 * PIPELINE (plateCore.ts has the image logic and the reasons):
 *   1. find rows of same-height glyphs on a light panel — plate-number rows;
 *   2. read each row's glyphs alone, redrawn clean (single line, A–Z 0–9 only);
 *      a second, grey read of the same row when the first is not certain;
 *   3. accept only "[code] + 1–5 digits" with as many characters as glyphs and
 *      high per-character confidence;
 *   4. for the winning row, one sparse read around it (number hidden) for the
 *      code beside it and the emirate name.
 *
 * THE RESULT HAS A VERDICT, so the app never fills in a guess:
 *   read    every check passed — the form fills in; the guard confirms.
 *   unsure  a plate-like number was found but a check failed — the app shows it
 *           as a suggestion the guard taps to use, or types over.
 *   none    nothing plate-like — the guard types the plate.
 * There is NO whole-photo fallback any more: reading all the text in a car
 * photo is exactly what produced confident nonsense from badges and signs.
 */
import type { Worker } from 'tesseract.js';
import { emirateIn, findRows, parseRow, renderGreyCrop, renderGreyRow, renderRowMask, type Grey, type Row } from './plateCore';
import { greyOf, greyToCanvas, loadBitmap } from './plateVision';

export type Verdict = 'read' | 'unsure' | 'none';

export interface PlateRead {
  code: string;
  number: string;
  emirate: string | null;
  raw: string;
  confidence: number; // 0–100
  verdict: Verdict;
  passes?: number;
}

let workerP: Promise<Worker> | null = null;

async function getWorker() {
  workerP ||= (async () => {
    const { createWorker, OEM } = await import('tesseract.js');
    return createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: '/ocr/worker.min.js',
      corePath: '/ocr/',
      langPath: '/ocr',
      gzip: true,
      // A real URL (not a blob:) so the worker's own requests go through the service worker cache offline.
      workerBlobURL: false,
    });
  })();
  try {
    return await workerP;
  } catch (e) {
    workerP = null; // let the next attempt try again (e.g. assets not cached yet)
    throw e;
  }
}

/** Load the engine in the background (after sign-in) so the first read is quick. */
export function warmUpOcr() {
  void getWorker().catch(() => {});
}

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const NONE = (passes = 0): PlateRead => ({ code: '', number: '', emirate: null, raw: '', confidence: 0, verdict: 'none', passes });

interface Sym {
  text: string;
  confidence: number;
}
interface OcrOut {
  text: string;
  confidence: number;
  symbols: Sym[];
  words: { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }[];
}

// Tesseract's worker is a single queue: calls must not interleave parameter changes.
let chain: Promise<unknown> = Promise.resolve();
function ocr(worker: Worker, img: Grey, psm: string): Promise<OcrOut> {
  const run = async () => {
    await worker.setParameters({ tessedit_pageseg_mode: psm as never, tessedit_char_whitelist: ALNUM, user_defined_dpi: '300' } as never);
    const { data } = await worker.recognize(greyToCanvas(img));
    if (import.meta.env.DEV) console.debug(`[plate] psm ${psm}`, JSON.stringify(data.text), Math.round(data.confidence));
    return data as unknown as OcrOut;
  };
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

/* ── judging one row ──────────────────────────────────────────────────── */
interface RowRead {
  code: string;
  number: string;
  conf: number;
  verdict: Verdict;
  raw: string;
}

function judge(out: OcrOut, row: Row): RowRead {
  const raw = (out.text || '').trim();
  const p = parseRow(raw);
  const syms = (out.symbols ?? []).filter((s) => /^[A-Z0-9]$/i.test(s.text));
  const confs = syms.map((s) => s.confidence);
  // Per-character confidence. (Tesseract's whole-line figure is 0 for many perfect single-line reads
  // with a whitelist, so it is not used.)
  const mean = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0;
  const min = confs.length ? Math.min(...confs) : 0;
  if (!p.ok || !p.number) return { code: '', number: '', conf: 0, verdict: 'none', raw };
  let { code, number } = p;
  // A code letter read in the same row must be clear on its own (a small K read as X otherwise).
  if (code && confs.slice(0, code.length).some((c) => c < 80)) code = '';
  let verdict: Verdict = 'unsure';
  // A long digit run is a code box merged into the number ("13 48217" → "1348217").
  if (number.length > 5) {
    if (code || number.length > 7) return { code: '', number: '', conf: 0, verdict: 'none', raw };
    code = number.slice(0, number.length - 5);
    number = number.slice(-5);
    return { code, number, conf: Math.min(mean, 50), verdict: 'unsure', raw };
  }
  const read = code.length + number.length;
  const lenOk = read === row.chars;
  if (number.length >= 3 && lenOk && p.fixed === 0 && mean >= 72 && min >= 45) verdict = 'read';
  const conf = Math.round(Math.max(0, Math.min(99, mean - (lenOk ? 0 : 15) - p.fixed * 12 - (number.length < 3 ? 25 : 0))));
  // Too weak to even suggest: showing it would only plant a wrong number in the guard's head.
  if (verdict !== 'read' && (number.length < 3 || conf < 35)) return { code: '', number: '', conf: 0, verdict: 'none', raw };
  return { code, number, conf, verdict, raw };
}

async function readRow(worker: Worker, full: Grey, row: Row, n: { passes: number }): Promise<RowRead> {
  // Two independent views of the same row: its glyphs redrawn clean, and the original grey pixels.
  // A number is only trusted when BOTH say it — a single confident read of an icon or a badge
  // ("274" from a decal at 91 %) was the main source of invented plates.
  // Render settings chosen by a sweep over 26 real plate rows: glyphs ~32 px with a tight vertical
  // margin read best (25/26 for the mask); larger renders flip 5 → 9 and 1 → 7 surprisingly often.
  const views = [
    () => renderRowMask(row, { target: 32, mx: 0.8, my: 0.3 }),
    () => renderGreyRow(full, row, { target: 32, mx: 0.4, my: 0.3 }),
    () => renderRowMask(row, { target: 40, mx: 0.4, my: 0.3 }),
  ];
  const reads: RowRead[] = [];
  for (let i = 0; i < views.length; i++) {
    reads.push(judge(await ocr(worker, views[i](), '7'), row));
    n.passes++;
    if (i === 0 && !reads[0].number && row.score < 0.5) return reads[0]; // weak row, nothing in it
    // Two views agree → done.
    if (i === 1 && reads[0].number && reads[0].number === reads[1].number) break;
  }
  const tally = new Map<string, RowRead[]>();
  for (const r of reads) if (r.number) tally.set(r.number, [...(tally.get(r.number) ?? []), r]);
  const top = [...tally.values()].sort((x, y) => y.length - x.length || Math.max(...y.map((r) => r.conf)) - Math.max(...x.map((r) => r.conf)))[0];
  if (!top) return reads[0];
  const best = top.slice().sort((x, y) => y.conf - x.conf)[0];
  const code = top.map((r) => r.code).find(Boolean) ?? '';
  if (top.length >= 2) {
    const conf = Math.min(99, best.conf + 4);
    const verdict: Verdict = best.number.length >= 3 && (top.some((r) => r.verdict === 'read') || conf >= 70) ? 'read' : 'unsure';
    return { code, number: best.number, conf, verdict, raw: best.raw };
  }
  // No two views agree: doubt. Offer the best as a suggestion, never fill it in.
  return { ...best, code, verdict: 'unsure', conf: Math.min(best.conf, 60) };
}

/** Look beside the number (number hidden) for its code and the emirate name. */
async function readSurroundings(worker: Worker, full: Grey, row: Row, n: { passes: number }) {
  const f = row.full;
  const ch = f.ch;
  const box = { x: f.x - ch * 5, y: f.y - ch * 1.6, w: f.w + ch * 5.6, h: f.h + ch * 3.2 };
  const blank = { x: f.x - ch * 0.15, y: f.y - ch * 0.15, w: f.w + ch * 0.3, h: f.h + ch * 0.3 };
  const out = await ocr(worker, renderGreyCrop(full, box, ch, blank), '11');
  n.passes++;
  const emirate = emirateIn(out.text || '');
  // Crop coordinates: glyph height ≈ 52 px; the number's left edge sits at (f.x - box.x) * k.
  const k = 52 / ch;
  const numLeft = (f.x - Math.max(0, box.x)) * k;
  const numTop = (f.y - Math.max(0, box.y)) * k;
  let code = '';
  let bestD = Infinity;
  for (const w of out.words ?? []) {
    const t = (w.text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!/^([A-Z]{1,2}|\d{1,2})$/.test(t) || t === 'AD') continue;
    const hgt = w.bbox.y1 - w.bbox.y0;
    if (w.confidence < 72 || hgt < 52 * 0.33 || hgt > 52 * 1.2) continue;
    const leftOf = w.bbox.x1 <= numLeft + 6;
    const above = w.bbox.y1 <= numTop + 6;
    if (!leftOf && !above) continue;
    const d = Math.hypot(numLeft - w.bbox.x1, (w.bbox.y0 + w.bbox.y1) / 2 - (numTop + 26));
    if (d < bestD) {
      bestD = d;
      code = t;
    }
  }
  return { code, emirate };
}

/** The core: find plate rows in grey pixels, read them, judge. */
async function readGrey(full: Grey, opts: { maxRows: number; maxPasses: number; surroundings: boolean }): Promise<PlateRead> {
  const worker = await getWorker();
  const rows = findRows(full, opts.maxRows);
  const n = { passes: 0 };
  let best: { r: RowRead; row: Row } | null = null;
  for (const row of rows) {
    if (n.passes >= opts.maxPasses) break;
    const r = await readRow(worker, full, row, n);
    if (!r.number) continue;
    if (!best || (r.verdict === 'read' && best.r.verdict !== 'read') || (r.verdict === best.r.verdict && r.conf > best.r.conf)) best = { r, row };
    if (r.verdict === 'read') break;
  }
  if (!best) return NONE(n.passes);
  let { code } = best.r;
  let emirate: string | null = null;
  if (opts.surroundings) {
    try {
      const s = await readSurroundings(worker, full, best.row, n);
      code ||= s.code;
      emirate = s.emirate;
    } catch {
      /* the number stands on its own */
    }
  }
  // Emirate markers printed beside the number are not codes (Ajman plates print "AJ").
  const MARK: Record<string, string> = { AJ: 'AJM', AD: 'AD', SHJ: 'SHJ', RAK: 'RAK', UAQ: 'UAQ', FUJ: 'FUJ' };
  if (MARK[code]) {
    emirate ||= MARK[code];
    code = '';
  }
  return { code, number: best.r.number, emirate, raw: best.r.raw, confidence: best.r.conf, verdict: best.r.verdict, passes: n.passes };
}

/** Read a still photo (the plate close-up, or a photo of the whole car). */
export async function readPlate(photo: Blob): Promise<PlateRead> {
  const img = await loadBitmap(photo);
  const g = greyOf(img, img.naturalWidth, img.naturalHeight, 1600);
  return readGrey(g, { maxRows: 6, maxPasses: 9, surroundings: true });
}

/**
 * Read one live-camera frame, already cropped to the on-screen guide box.
 * Cheap on purpose — the scanner votes across frames.
 */
export async function readFrame(crop: HTMLCanvasElement): Promise<PlateRead> {
  const g = greyOf(crop, crop.width, crop.height, 1000);
  return readGrey(g, { maxRows: 2, maxPasses: 3, surroundings: false });
}
