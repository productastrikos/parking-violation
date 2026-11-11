/**
 * Read the number plate from the close-up photo — ON THE PHONE, OFFLINE.
 *
 * Tesseract.js (OCR compiled to WebAssembly) runs inside the app. Its worker,
 * engine and English model are self-hosted under /ocr/ and precached by the
 * service worker, so this works in a basement with no signal, on Android and
 * iPhone. First use takes a few seconds while the engine loads; later reads
 * reuse the loaded worker.
 *
 * WHAT IT IS GOOD AT, HONESTLY. A straight-on close-up where the plate fills
 * most of the frame: usually right or one character off. A whole car from
 * across the road: usually wrong. That is why the app asks for a separate
 * plate photo, and why the guard ALWAYS confirms or edits the result. The
 * record says whether the plate came from the reader or was typed.
 *
 * UAE plates carry a code (digits in Abu Dhabi, letters in Dubai) and a number
 * of up to 5 digits, plus the emirate's name. The parser keeps letters and
 * digits, drops the emirate words, takes the longest 1–5 digit group as the
 * number and a short group next to it as the code, and guesses the emirate
 * from the words it saw.
 */
import type { Worker } from 'tesseract.js';
import { ocrCanvas } from './photo';

export interface PlateRead {
  code: string;
  number: string;
  emirate: string | null;
  raw: string;
  confidence: number; // 0–100, Tesseract's own
}

let workerP: Promise<Worker> | null = null;

async function getWorker() {
  workerP ||= (async () => {
    const { createWorker, OEM, PSM } = await import('tesseract.js');
    const w = await createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: '/ocr/worker.min.js',
      corePath: '/ocr/',
      langPath: '/ocr',
      gzip: true,
      // A real URL (not a blob:) so the worker's own requests go through the service worker cache offline.
      workerBlobURL: false,
    });
    await w.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ',
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
    });
    return w;
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
  const best = digitGroups.sort((a, b) => b.p.length - a.p.length)[0];
  if (!best) return { code: '', number: '', emirate, raw: text.trim() };

  // The code is the short token nearest the number: 1–2 digits (Abu Dhabi, Sharjah…) or 1–2 letters (Dubai).
  const near = [best.i - 1, best.i + 1, best.i - 2, best.i + 2]
    .map((i) => parts[i])
    .find((p) => p && p !== best.p && (/^\d{1,2}$/.test(p) || /^[A-Z]{1,2}$/.test(p)));

  const guessEmirate = emirate ?? (near && /^[A-Z]+$/.test(near) ? 'DXB' : null);
  return { code: plausibleCode(near ?? '', guessEmirate), number: best.p, emirate: guessEmirate, raw: text.trim() };
}

/**
 * Outside Dubai the code is digits. OCR often turns a coloured code box into
 * letters ("5" → "S", "8" → "B"); fix the usual look-alikes, and if letters
 * remain, return nothing so the guard types the code instead of trusting a
 * wrong one.
 */
const LOOKALIKE: Record<string, string> = { O: '0', D: '0', Q: '0', I: '1', L: '1', T: '1', Z: '2', S: '5', G: '6', B: '8' };
function plausibleCode(code: string, emirate: string | null) {
  if (!code || emirate === 'DXB') return code;
  const fixed = code.replace(/[A-Z]/g, (ch) => LOOKALIKE[ch] ?? ch);
  return /^\d{1,2}$/.test(fixed) ? fixed : '';
}

export async function readPlate(photo: Blob): Promise<PlateRead> {
  const worker = await getWorker();
  const canvas = await ocrCanvas(photo);
  const { data } = await worker.recognize(canvas);
  const parsed = parsePlate(data.text || '');
  return { ...parsed, confidence: Math.round(data.confidence ?? 0) };
}
