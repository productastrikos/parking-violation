/**
 * Self-host the plate-reader (Tesseract.js) files under public/ocr/.
 *
 * WHY. By default Tesseract.js downloads its worker, WASM core and language
 * data from a CDN on first use. A guard standing in a car park with no signal
 * would get nothing. Copied into public/, the service worker precaches them
 * with the app shell, so plate reading works on a phone that is fully offline
 * — on Android and iPhone alike.
 *
 * Runs on `npm install` (postinstall). Safe to re-run; it only copies.
 * The English language data (`eng.traineddata.gz`, ~2 MB, the "fast" model)
 * is fetched once from jsDelivr if it is not already in public/ocr/ — that is
 * a build-machine download, never a phone download.
 */
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const out = path.join(root, 'public', 'ocr');
fs.mkdirSync(out, { recursive: true });

function copy(from, to) {
  const src = path.join(root, 'node_modules', from);
  if (!fs.existsSync(src)) {
    console.warn(`[ocr] missing ${from} — plate reading will fall back to manual entry`);
    return;
  }
  fs.copyFileSync(src, path.join(out, to));
}

copy('tesseract.js/dist/worker.min.js', 'worker.min.js');
// The SIMD+LSTM build covers every phone from the last ~5 years (iOS 16.4+, Chrome 91+);
// the plain LSTM build is the fallback Tesseract picks when SIMD is unavailable.
// The .wasm.js builds embed the WASM, so the separate .wasm files are not needed.
for (const f of ['tesseract-core-simd-lstm.wasm.js', 'tesseract-core-lstm.wasm.js']) {
  copy(`tesseract.js-core/${f}`, f);
}

const lang = path.join(out, 'eng.traineddata.gz');
if (fs.existsSync(lang) && fs.statSync(lang).size > 100_000) {
  console.log('[ocr] assets ready in public/ocr');
} else {
  const url = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz';
  await new Promise((resolve) => {
    const get = (u, hops = 0) =>
      https
        .get(u, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 5) return get(res.headers.location, hops + 1);
          if (res.statusCode !== 200) {
            console.warn(`[ocr] language data download failed (${res.statusCode}) — plate reading will be manual only`);
            res.resume();
            return resolve();
          }
          const file = fs.createWriteStream(lang);
          res.pipe(file);
          file.on('finish', () => file.close(() => {
            console.log('[ocr] assets ready in public/ocr');
            resolve();
          }));
        })
        .on('error', (e) => {
          console.warn(`[ocr] language data download failed (${e.message}) — plate reading will be manual only`);
          resolve();
        });
    get(url);
  });
}
