/**
 * Read the number plate — ON THE PHONE, OFFLINE.
 *
 * Tesseract.js (OCR in WebAssembly) runs inside the app. Its worker, engine and
 * English model are self-hosted under /ocr/ and precached by the service
 * worker, so this works in a basement with no signal, on Android and iPhone.
 *
 * PIPELINE (each step measured on test-plates/):
 *   1. locate the plate in the photo (plateVision.locatePlate) and crop it;
 *   2. read the crop twice — binarised and grey — as a single line (psm 7)
 *      and as a block (psm 6);
 *   3. if no crop or no number, read the whole photo (psm 6, then 11);
 *   4. VOTE: candidates are grouped by plate number and weighted by
 *      Tesseract's confidence; the code comes from the passes that agree.
 * Early exit when the first two crop passes agree with good confidence, so a
 * clear plate costs one or two passes (~0.3–1 s on a phone).
 *
 * The live scanner (PlateScanner.tsx) feeds camera frames through
 * `readFrame`, which reads only the guide-box crop, and votes across frames.
 *
 * HONEST LIMITS. The guard ALWAYS confirms the result; the record says whether
 * the plate came from the reader or was typed. Dirty, angled or night plates
 * read worse — typing is always available.
 */
import type { Worker } from 'tesseract.js';
import { cropForOcr, loadBitmap, locatePlate } from './plateVision';
import { ocrCanvas } from './photo';

export interface PlateRead {
  code: string;
  number: string;
  emirate: string | null;
  raw: string;
  confidence: number; // 0–100
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

/* ── parsing ───────────────────────────────────────────────────────────── */
const EMIRATE_WORDS: [RegExp, string][] = [
  [/DUBAI/, 'DXB'],
  [/ABU|DHABI|ABUDHABI/, 'AD'],
  [/SHARJAH|SHARJA/, 'SHJ'],
  [/AJMAN/, 'AJM'],
  [/QUWAIN|UAQ/, 'UAQ'],
  [/KHAIMAH|RAK\b/, 'RAK'],
  [/FUJAIRAH|FUJAIRA/, 'FUJ'],
];
const NOISE = /^(UAE|ABU|DHABI|ABUDHABI|DUBAI|SHARJAH|AJMAN|UMM|AL|QUWAIN|RAS|KHAIMAH|FUJAIRAH|AD|PRIVATE|TAXI|EMIRATES)$/;

export function parsePlate(text: string): Omit<PlateRead, 'confidence'> {
  const up = text.toUpperCase();
  const emirate = EMIRATE_WORDS.find(([re]) => re.test(up.replace(/\s+/g, '')) || re.test(up))?.[1] ?? null;
  const tokens = up
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
    .filter((t) => !NOISE.test(t));

  // Split mixed tokens like "A12345" → "A", "12345".
  const parts: string[] = [];
  for (const t of tokens) {
    const m = t.match(/^([A-Z]{1,2})(\d{1,5})$/);
    if (m) parts.push(m[1], m[2]);
    else parts.push(t);
  }

  const digitGroups = parts.map((p, i) => ({ p, i })).filter(({ p }) => /^\d{1,5}$/.test(p));
  // The number is the longest digit group; ties go to the later one (the code usually comes first).
  const best = digitGroups.sort((a, b) => b.p.length - a.p.length || b.i - a.i)[0];
  if (!best || best.p.length < 2) return { code: '', number: '', emirate, raw: text.trim() };

  // The code is the short token nearest the number: 1–2 digits (Abu Dhabi, Sharjah…) or 1–2 letters (Dubai).
  const near = [best.i - 1, best.i + 1, best.i - 2, best.i + 2]
    .map((i) => parts[i])
    .find((p) => p && p !== best.p && (/^\d{1,2}$/.test(p) || /^[A-Z]{1,2}$/.test(p)));

  // The emirate is only set when its NAME was read — guessing it from a (possibly misread) code
  // turned an Abu Dhabi "7" read as "B" into a Dubai plate in testing.
  return { code: plausibleCode(near ?? '', emirate), number: best.p, emirate, raw: text.trim() };
}

/**
 * Outside Dubai the code is digits. OCR often turns a coloured code box into
 * letters ("5" → "S", "8" → "B"); fix the usual look-alikes, and if letters
 * remain, return nothing so the guard types the code instead of trusting a
 * wrong one. Unknown emirate: keep the code exactly as read.
 */
const LOOKALIKE: Record<string, string> = { O: '0', D: '0', Q: '0', I: '1', L: '1', T: '1', Z: '2', S: '5', G: '6', B: '8' };
function plausibleCode(code: string, emirate: string | null) {
  if (!code || !emirate || emirate === 'DXB') return code;
  const fixed = code.replace(/[A-Z]/g, (ch) => LOOKALIKE[ch] ?? ch);
  return /^\d{1,2}$/.test(fixed) ? fixed : '';
}

/* ── voting ────────────────────────────────────────────────────────────── */
interface Candidate extends PlateRead {
  pass: string;
}

export function vote(cands: Candidate[]): PlateRead | null {
  const withNum = cands.filter((c) => c.number);
  if (!withNum.length) return null;
  const byNum = new Map<string, Candidate[]>();
  for (const c of withNum) byNum.set(c.number, [...(byNum.get(c.number) ?? []), c]);
  // A reading contained in a LONGER reading supports the longer one: OCR on a cropped or tilted
  // plate drops digits far more often than it invents them ("9031" inside "90316").
  const nums = [...byNum.keys()];
  for (const short of nums) {
    const longer = nums.filter((n) => n !== short && n.length > short.length && n.includes(short)).sort((a, b) => b.length - a.length)[0];
    if (longer && byNum.has(short)) {
      byNum.set(longer, [...byNum.get(longer)!, ...byNum.get(short)!.map((c) => ({ ...c, number: longer, confidence: c.confidence * 0.8 }))]);
      byNum.delete(short);
    }
  }
  const scored = [...byNum.entries()].map(([num, cs]) => ({
    num,
    cs,
    // Agreement counts most; plate-length numbers (3–5 digits) are likelier than stray 2-digit reads.
    score: cs.reduce((s, c) => s + Math.max(20, c.confidence), 0) * (num.length >= 3 ? 1.25 : 1),
  }));
  scored.sort((a, b) => b.score - a.score);
  const win = scored[0];
  const codes = new Map<string, number>();
  for (const c of win.cs) if (c.code) codes.set(c.code, (codes.get(c.code) ?? 0) + Math.max(20, c.confidence));
  const code = [...codes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  const emirate = win.cs.find((c) => c.emirate)?.emirate ?? cands.find((c) => c.emirate)?.emirate ?? null;
  let confidence = Math.round(Math.min(99, win.cs.reduce((s, c) => s + c.confidence, 0) / win.cs.length + (win.cs.length - 1) * 6));
  // A 1–2 digit "number" is far more often a misread code than a real plate number: flag it, don't trust it.
  if (win.num.length <= 2) confidence = Math.min(confidence, 35);
  return { code: plausibleCode(code, emirate), number: win.num, emirate, raw: win.cs[0].raw, confidence, passes: cands.length };
}

async function pass(worker: Worker, image: HTMLCanvasElement, psm: string, label: string): Promise<Candidate> {
  await worker.setParameters({ tessedit_pageseg_mode: psm as never });
  const { data } = await worker.recognize(image);
  if (import.meta.env.DEV) console.debug(`[plate-ocr] ${label} psm ${psm}:`, JSON.stringify(data.text), Math.round(data.confidence));
  return { ...parsePlate(data.text || ''), confidence: Math.round(data.confidence ?? 0), pass: `${label}/${psm}` };
}


/** Read a still photo (the plate close-up). */
export async function readPlate(photo: Blob): Promise<PlateRead> {
  const worker = await getWorker();
  const img = await loadBitmap(photo);
  const sw = img.naturalWidth;
  const sh = img.naturalHeight;
  const cands: Candidate[] = [];

  const box = locatePlate(img, sw, sh);
  if (box) {
    // The densest box is often just the NUMBER; the code box sits to its left (or right).
    // A wider crop takes in the whole plate so the code is read too.
    const wx = Math.max(0, box.x - box.w * 0.5);
    const wide = { x: wx, y: Math.max(0, box.y - box.h * 0.2), w: Math.min(1 - wx, box.w * 1.75), h: Math.min(1, box.h * 1.4) };
    const wideBin = cropForOcr(img, sw, sh, wide, true);
    const bin = cropForOcr(img, sw, sh, box, true);
    cands.push(await pass(worker, wideBin, '7', 'wide-bin'));
    cands.push(await pass(worker, bin, '7', 'crop-bin'));
    cands.push(await pass(worker, wideBin, '6', 'wide-bin'));
  }
  // The whole photo (≤1400 px, grey, contrast-stretched): always one vote, and the fallback when no plate box was found.
  const whole = await ocrCanvas(photo);
  cands.push(await pass(worker, whole, '6', 'full'));
  if (!cands.some((c) => c.number)) cands.push(await pass(worker, whole, '11', 'full'));
  return vote(cands) ?? { code: '', number: '', emirate: cands.find((c) => c.emirate)?.emirate ?? null, raw: cands.map((c) => c.raw).join(' | '), confidence: 0, passes: cands.length };
}

/**
 * Read one live-camera frame, already cropped to the on-screen guide box.
 * Cheap on purpose (one or two passes) — the scanner votes across frames.
 */
export async function readFrame(crop: HTMLCanvasElement): Promise<PlateRead | null> {
  const worker = await getWorker();
  const bin = cropForOcr(crop, crop.width, crop.height, { x: 0.02, y: 0.04, w: 0.96, h: 0.92 }, true);
  const a = await pass(worker, bin, '7', 'frame');
  if (a.number && a.confidence >= 55) return a;
  const b = await pass(worker, bin, '6', 'frame');
  return vote([a, b]);
}
