/**
 * The plate reader's image logic — pure functions on grey pixel arrays, no DOM,
 * so the same code runs on the phone and in the test harness.
 *
 * WHY THIS DESIGN. The first reader looked for "a bright box full of edges"
 * and then OCR'd whatever was inside — and OCR'd the whole photo as a fallback.
 * On real car photos that read badges, grilles, signs and stickers, and the
 * longest run of digits anywhere won: confident nonsense. This reader works
 * the way licence-plate readers do:
 *
 *   1. FIND CHARACTERS, NOT BOXES. Adaptive threshold (each pixel against its
 *      own neighbourhood, so shade and glare don't matter), then connected
 *      components. A component that is character-shaped (height, aspect,
 *      fill) is a candidate glyph. Done on a 3-level pyramid so a plate that
 *      fills the frame and a plate 30 px high are both found.
 *   2. FIND A ROW OF THEM. A plate number is 3–6 glyphs of the SAME height,
 *      top- and bottom-aligned, tightly spaced, dark on a light panel.
 *      Grilles, wheels and Arabic script fail these tests; sign text usually
 *      passes them but then fails step 4 (letters where digits must be).
 *   3. READ ONLY THOSE GLYPHS. The row's own pixels are redrawn black on
 *      white at the size Tesseract reads best — the plate frame, screws, dirt
 *      and the emirate logo are simply not in the picture.
 *   4. CHECK IT. The text must be [code letters] + 1–5 digits, the number of
 *      characters read must match the number of glyphs found, and the
 *      per-character confidence must be high. Otherwise it is offered as a
 *      SUGGESTION the guard confirms, never filled in silently.
 */

export interface Grey {
  w: number;
  h: number;
  d: Uint8Array;
}

export interface Comp {
  id: number;
  x0: number;
  y0: number;
  x1: number; // inclusive
  y1: number;
  n: number; // pixel count
}

export interface Level {
  g: Grey;
  scale: number; // level px = full px * scale
  labels: Int32Array; // component id per pixel (dark polarity), 0 = none
  dark: Uint8Array; // 1 = darker than its neighbourhood
}

export interface Row {
  level: Level;
  comps: Comp[];
  x: number; // level px
  y: number;
  w: number;
  h: number;
  ch: number; // median glyph height, level px
  chars: number; // estimated characters (wide blobs count as 2)
  contrast: number;
  score: number;
  /** Baseline tilt (dy/dx) and the centre line's y at the row's middle — level px. */
  slope: number;
  cy: number;
  /** In full-image px. */
  full: { x: number; y: number; w: number; h: number; ch: number; cy: number };
}

/* ── pixels ───────────────────────────────────────────────────────────── */

export function greyFromRgba(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Grey {
  const d = new Uint8Array(w * h);
  for (let i = 0, j = 0; j < d.length; i += 4, j++) d[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  return { w, h, d };
}

/** Half size, 2×2 box filter. */
function halve(g: Grey): Grey {
  const w = g.w >> 1;
  const h = g.h >> 1;
  const d = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const a = 2 * y * g.w;
    const b = a + g.w;
    for (let x = 0; x < w; x++) d[y * w + x] = (g.d[a + 2 * x] + g.d[a + 2 * x + 1] + g.d[b + 2 * x] + g.d[b + 2 * x + 1] + 2) >> 2;
  }
  return { w, h, d };
}

/** 1 where the pixel is clearly darker than the mean of its (2r+1)² neighbourhood. */
function adaptiveDark(g: Grey, r: number): Uint8Array {
  const { w, h, d } = g;
  const W = w + 1;
  const I = new Uint32Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += d[y * w + x];
      I[(y + 1) * W + x + 1] = I[y * W + x + 1] + row;
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const mean = (I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0]) / ((y1 - y0) * (x1 - x0));
      out[y * w + x] = d[y * w + x] < mean * 0.86 - 6 ? 1 : 0;
    }
  }
  return out;
}

/** 8-connected components of the 1-pixels. */
function components(mask: Uint8Array, w: number, h: number): { labels: Int32Array; comps: Comp[] } {
  const labels = new Int32Array(w * h);
  const comps: Comp[] = [];
  const stack = new Int32Array(w * h);
  let id = 0;
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || labels[s]) continue;
    id++;
    let sp = 0;
    stack[sp++] = s;
    labels[s] = id;
    let x0 = w;
    let y0 = h;
    let x1 = 0;
    let y1 = 0;
    let n = 0;
    while (sp) {
      const p = stack[--sp];
      const px = p % w;
      const py = (p - px) / w;
      n++;
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (py < y0) y0 = py;
      if (py > y1) y1 = py;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = py + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          if (nx < 0 || nx >= w) continue;
          const q = ny * w + nx;
          if (mask[q] && !labels[q]) {
            labels[q] = id;
            stack[sp++] = q;
          }
        }
      }
    }
    comps.push({ id, x0, y0, x1, y1, n });
  }
  return { labels, comps };
}

/* ── finding plate-number rows ─────────────────────────────────────────── */

const cw = (c: Comp) => c.x1 - c.x0 + 1;
const chh = (c: Comp) => c.y1 - c.y0 + 1;

function glyphLike(c: Comp, w: number, h: number) {
  const ww = cw(c);
  const hh = chh(c);
  if (hh < 9 || hh > h * 0.92 || ww < 2) return false;
  if (c.x0 <= 0 || c.x1 >= w - 1) return false;
  // A glyph may touch the top/bottom edge only in a tight crop of a plate (glyph ≥ half the height).
  if ((c.y0 <= 0 || c.y1 >= h - 1) && hh < h * 0.5) return false;
  const aspect = ww / hh;
  if (aspect < 0.08 || aspect > 1.5) return false;
  const fill = c.n / (ww * hh);
  return fill > 0.14 && fill < 0.92;
}

function rowsOnLevel(level: Level, comps: Comp[]): Row[] {
  const { w, h } = level.g;
  const glyphs = comps.filter((c) => glyphLike(c, w, h)).sort((a, b) => a.x0 - b.x0);
  const used = new Set<number>();
  const rows: Row[] = [];
  for (let i = 0; i < glyphs.length; i++) {
    const first = glyphs[i];
    if (used.has(first.id)) continue;
    const members = [first];
    let last = first;
    for (;;) {
      const lh = chh(last);
      let next: Comp | null = null;
      for (let j = i + 1; j < glyphs.length; j++) {
        const c = glyphs[j];
        if (c.x0 > last.x1 + lh * 0.9) break;
        if (used.has(c.id) || members.includes(c) || c.x0 <= last.x0) continue;
        const ch = chh(c);
        // 0.32: a plate tilted ~18° still chains glyph to glyph.
        const tol = Math.max(lh, ch) * 0.32 + 1;
        if (Math.max(ch, lh) / Math.min(ch, lh) > 1.3) continue;
        if (Math.abs(c.y0 - last.y0) > tol || Math.abs(c.y1 - last.y1) > tol) continue;
        if (c.x0 < last.x1 - lh * 0.15) continue;
        if (!next || c.x0 < next.x0) next = c;
      }
      if (!next) break;
      members.push(next);
      last = next;
    }
    const heights = members.map(chh).sort((a, b) => a - b);
    const ch = heights[heights.length >> 1];
    const chars = members.reduce((s, c) => s + Math.max(1, Math.round(cw(c) / (ch * 0.62))), 0);
    if (chars < 3 || members.length < 2) continue;
    members.forEach((c) => used.add(c.id));
    const mean = heights.reduce((s, v) => s + v, 0) / heights.length;
    const cv = Math.sqrt(heights.reduce((s, v) => s + (v - mean) ** 2, 0) / heights.length) / mean;
    if (cv > 0.12) continue;
    const x = members[0].x0;
    const y = Math.min(...members.map((c) => c.y0));
    const x1 = members[members.length - 1].x1;
    const y1 = Math.max(...members.map((c) => c.y1));
    const contrast = rowContrast(level, members, x, y, x1 - x + 1, y1 - y + 1, ch);
    if (contrast < 45) continue;
    // Tilt: least-squares line through the glyph centres, so a tilted plate is read straightened.
    const cxs = members.map((c) => (c.x0 + c.x1) / 2);
    const cys = members.map((c) => (c.y0 + c.y1) / 2);
    const mx = cxs.reduce((a, b) => a + b, 0) / cxs.length;
    const my = cys.reduce((a, b) => a + b, 0) / cys.length;
    let sxy = 0;
    let sxx = 0;
    cxs.forEach((v, k) => {
      sxy += (v - mx) * (cys[k] - my);
      sxx += (v - mx) ** 2;
    });
    const slope = sxx ? Math.max(-0.45, Math.min(0.45, sxy / sxx)) : 0;
    const midX = (x + x1) / 2;
    const cy = my + slope * (midX - mx);
    const s = level.scale;
    const charFit = chars <= 6 ? Math.min(chars, 5) / 5 : chars <= 8 ? 0.7 : 0.35;
    const score = charFit * (contrast / 255) * Math.sqrt(ch / s) * (1 - cv * 3);
    rows.push({
      level,
      comps: members,
      x,
      y,
      w: x1 - x + 1,
      h: y1 - y + 1,
      ch,
      chars,
      contrast,
      score,
      slope,
      cy,
      full: { x: x / s, y: y / s, w: (x1 - x + 1) / s, h: (y1 - y + 1) / s, ch: ch / s, cy: cy / s },
    });
  }
  return rows;
}

/** Light panel behind dark glyphs: mean background minus mean glyph grey, around the row. */
function rowContrast(level: Level, members: Comp[], x: number, y: number, w: number, h: number, ch: number) {
  const { g, labels } = level;
  const ids = new Set(members.map((c) => c.id));
  const mx = Math.round(ch * 0.3);
  const my = Math.round(ch * 0.2);
  const X0 = Math.max(0, x - mx);
  const Y0 = Math.max(0, y - my);
  const X1 = Math.min(g.w, x + w + mx);
  const Y1 = Math.min(g.h, y + h + my);
  let fg = 0;
  let nf = 0;
  let bg = 0;
  let nb = 0;
  for (let yy = Y0; yy < Y1; yy++) {
    for (let xx = X0; xx < X1; xx++) {
      const p = yy * g.w + xx;
      if (ids.has(labels[p])) {
        fg += g.d[p];
        nf++;
      } else if (!level.dark[p]) {
        bg += g.d[p];
        nb++;
      }
    }
  }
  if (!nf || !nb) return 0;
  const bgm = bg / nb;
  if (bgm < 70) return 0; // plates are light; a dark panel is a grille, a tyre, a window
  return bgm - fg / nf;
}

const iou = (a: Row['full'], b: Row['full']) => {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const i = ix * iy;
  return i / (a.w * a.h + b.w * b.h - i);
};

/**
 * Candidate plate-number rows, best first. `g` should be ≤ ~1600 px on its long
 * side; levels at ½ and ¼ catch plates whose glyphs are too big for the
 * threshold window at full size.
 */
export function findRows(g: Grey, max = 6): Row[] {
  const levels: Level[] = [];
  let cur = g;
  let scale = 1;
  for (let i = 0; i < 3; i++) {
    if (Math.min(cur.w, cur.h) < 48) break;
    const dark = adaptiveDark(cur, 15);
    const { labels, comps } = components(dark, cur.w, cur.h);
    const level: Level = { g: cur, scale, labels, dark };
    levels.push(level);
    (level as Level & { comps: Comp[] }).comps = comps;
    cur = halve(cur);
    scale /= 2;
  }
  const all: Row[] = [];
  for (const l of levels) all.push(...rowsOnLevel(l, (l as Level & { comps: Comp[] }).comps));
  all.sort((a, b) => b.score - a.score);
  const out: Row[] = [];
  for (const r of all) {
    if (out.some((o) => iou(o.full, r.full) > 0.3)) continue;
    out.push(r);
    if (out.length >= max) break;
  }
  return out;
}

/* ── rendering crops for the OCR ─────────────────────────────────────── */

const TARGET = 52; // glyph height Tesseract reads best, px

/** The row's glyphs only, black on white, anti-aliased, glyph height ≈ 52 px. */
export interface RenderOpts {
  target?: number; // glyph height in the output, px
  mx?: number; // side margin, in glyph heights
  my?: number; // top/bottom margin, in glyph heights
}

export function renderRowMask(r: Row, o: RenderOpts = {}): Grey {
  const { labels, g } = r.level;
  const ids = new Set(r.comps.map((c) => c.id));
  const k = (o.target ?? TARGET) / r.ch;
  const mx = r.ch * (o.mx ?? 0.7);
  const half = r.ch * (0.5 + (o.my ?? 0.5)); // half the band height around the tilt line
  const w = Math.round((r.w + 2 * mx) * k);
  const h = Math.round(2 * half * k);
  const d = new Uint8Array(w * h);
  const sx0 = r.x - mx;
  const midX = r.x + r.w / 2;
  for (let oy = 0; oy < h; oy++) {
    for (let ox = 0; ox < w; ox++) {
      let ink = 0;
      for (let s = 0; s < 4; s++) {
        const fx = sx0 + (ox + 0.25 + (s & 1) * 0.5) / k;
        const sx = Math.floor(fx);
        const sy = Math.floor(r.cy + r.slope * (fx - midX) - half + (oy + 0.25 + (s >> 1) * 0.5) / k);
        if (sx >= 0 && sy >= 0 && sx < g.w && sy < g.h && ids.has(labels[sy * g.w + sx])) ink++;
      }
      d[oy * w + ox] = Math.round(255 - ink * 63.75);
    }
  }
  return { w, h, d };
}

/** The row's band of the original grey pixels, straightened along its tilt, glyphs ≈52 px, contrast-stretched. */
export function renderGreyRow(full: Grey, r: Row, o: RenderOpts = {}): Grey {
  const f = r.full;
  const k = (o.target ?? TARGET) / f.ch;
  const mx = f.ch * (o.mx ?? 0.6);
  const half = f.ch * (0.5 + (o.my ?? 0.4));
  const w = Math.max(1, Math.round((f.w + 2 * mx) * k));
  const h = Math.max(1, Math.round(2 * half * k));
  const d = new Uint8Array(w * h);
  const midX = f.x + f.w / 2;
  const at = (x: number, y: number) => {
    const x0 = Math.max(0, Math.min(full.w - 1, Math.floor(x)));
    const y0 = Math.max(0, Math.min(full.h - 1, Math.floor(y)));
    const x1 = Math.min(full.w - 1, x0 + 1);
    const y1 = Math.min(full.h - 1, y0 + 1);
    const tx = Math.max(0, Math.min(1, x - x0));
    const ty = Math.max(0, Math.min(1, y - y0));
    const a = full.d[y0 * full.w + x0] * (1 - tx) + full.d[y0 * full.w + x1] * tx;
    const b = full.d[y1 * full.w + x0] * (1 - tx) + full.d[y1 * full.w + x1] * tx;
    return a * (1 - ty) + b * ty;
  };
  for (let oy = 0; oy < h; oy++) {
    for (let ox = 0; ox < w; ox++) {
      const fx = f.x - mx + (ox + 0.5) / k;
      d[oy * w + ox] = at(fx, f.cy + r.slope * (fx - midX) - half + (oy + 0.5) / k);
    }
  }
  return stretch({ w, h, d });
}

function stretch(g: Grey): Grey {
  const hist = new Uint32Array(256);
  for (const v of g.d) hist[v]++;
  const n = g.d.length;
  let lo = 0;
  let hi = 255;
  for (let acc = 0, i = 0; i < 256; i++) if ((acc += hist[i]) >= n * 0.02) { lo = i; break; }
  for (let acc = 0, i = 255; i >= 0; i--) if ((acc += hist[i]) >= n * 0.02) { hi = i; break; }
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < n; i++) g.d[i] = Math.max(0, Math.min(255, ((g.d[i] - lo) * 255) / span));
  return g;
}

/**
 * A grey crop of the full image around a full-px box, scaled so glyphs are
 * ≈52 px high and contrast-stretched. `blank` (full px rect) is painted white —
 * used to hide the number when looking for the code beside it.
 */
export function renderGreyCrop(full: Grey, box: { x: number; y: number; w: number; h: number }, ch: number, blank?: { x: number; y: number; w: number; h: number }): Grey {
  const k = TARGET / ch;
  const X0 = Math.max(0, box.x);
  const Y0 = Math.max(0, box.y);
  const X1 = Math.min(full.w, box.x + box.w);
  const Y1 = Math.min(full.h, box.y + box.h);
  const w = Math.max(1, Math.round((X1 - X0) * k));
  const h = Math.max(1, Math.round((Y1 - Y0) * k));
  const d = new Uint8Array(w * h);
  const hist = new Uint32Array(256);
  for (let oy = 0; oy < h; oy++) {
    const fy = Y0 + (oy + 0.5) / k - 0.5;
    const y0 = Math.max(0, Math.min(full.h - 1, Math.floor(fy)));
    const y1 = Math.min(full.h - 1, y0 + 1);
    const ty = Math.max(0, Math.min(1, fy - y0));
    for (let ox = 0; ox < w; ox++) {
      const fx = X0 + (ox + 0.5) / k - 0.5;
      const x0 = Math.max(0, Math.min(full.w - 1, Math.floor(fx)));
      const x1 = Math.min(full.w - 1, x0 + 1);
      const tx = Math.max(0, Math.min(1, fx - x0));
      const a = full.d[y0 * full.w + x0] * (1 - tx) + full.d[y0 * full.w + x1] * tx;
      const b = full.d[y1 * full.w + x0] * (1 - tx) + full.d[y1 * full.w + x1] * tx;
      const v = Math.round(a * (1 - ty) + b * ty);
      d[oy * w + ox] = v;
      hist[v]++;
    }
  }
  // Stretch 2nd–98th percentile to full range.
  const n = w * h;
  let lo = 0;
  let hi = 255;
  for (let acc = 0, i = 0; i < 256; i++) if ((acc += hist[i]) >= n * 0.02) { lo = i; break; }
  for (let acc = 0, i = 255; i >= 0; i--) if ((acc += hist[i]) >= n * 0.02) { hi = i; break; }
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < n; i++) d[i] = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / span));
  if (blank) {
    const bx0 = Math.round((blank.x - X0) * k);
    const by0 = Math.round((blank.y - Y0) * k);
    const bx1 = Math.round((blank.x + blank.w - X0) * k);
    const by1 = Math.round((blank.y + blank.h - Y0) * k);
    for (let y = Math.max(0, by0); y < Math.min(h, by1); y++) for (let x = Math.max(0, bx0); x < Math.min(w, bx1); x++) d[y * w + x] = 255;
  }
  return { w, h, d };
}

/* ── interpreting what the OCR read ──────────────────────────────────── */

const TO_DIGIT: Record<string, string> = { O: '0', D: '0', Q: '0', U: '0', I: '1', L: '1', T: '1', J: '1', Z: '2', S: '5', G: '6', B: '8', A: '4' };

export interface RowText {
  code: string; // letters (or digits) read in the same row before the number
  number: string;
  fixed: number; // look-alike letters turned into digits
  ok: boolean; // shaped like [A–Z]{0,2} + digits
}

/**
 * "K72397" → K · 72397. "6I86" → 6186 (one look-alike fixed). "POLICE" → not a
 * plate. Letters may only come FIRST (the Dubai code); anything after the
 * digits start must be a digit or a common look-alike of one.
 */
export function parseRow(text: string): RowText {
  const t = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = t.match(/^([A-Z]{0,2})([0-9][A-Z0-9]*)$/);
  if (!m) {
    // All letters, or letters after digits — maybe a look-alike-only number ("SI86").
    const conv = t.replace(/[A-Z]/g, (c) => TO_DIGIT[c] ?? c);
    if (/^\d{3,5}$/.test(conv) && t.length - t.replace(/[A-Z]/g, '').length <= 1) return { code: '', number: conv, fixed: 1, ok: true };
    return { code: '', number: '', fixed: 0, ok: false };
  }
  let fixed = 0;
  const number = m[2].replace(/[A-Z]/g, (c) => {
    fixed++;
    return TO_DIGIT[c] ?? '?';
  });
  if (number.includes('?')) return { code: m[1], number: '', fixed, ok: false };
  return { code: m[1], number, fixed, ok: true };
}

export const EMIRATE_WORDS: [RegExp, string][] = [
  [/DUBAI|DUBA|UBAI/, 'DXB'],
  [/ABUDHABI|DHABI|ABU/, 'AD'],
  [/SHARJAH|SHARJA|SHJ/, 'SHJ'],
  [/AJMAN/, 'AJM'],
  [/QUWAIN|UAQ/, 'UAQ'],
  [/KHAIMAH|RAK/, 'RAK'],
  [/FUJAIRAH|FUJAIRA|FUJ/, 'FUJ'],
];

export function emirateIn(text: string): string | null {
  const t = text.toUpperCase().replace(/[^A-Z]/g, '');
  return EMIRATE_WORDS.find(([re]) => re.test(t))?.[1] ?? null;
}
