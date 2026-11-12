/**
 * The printed penalty notice — drawn once as a black-and-white picture at the
 * printer's dot width, then sent to whichever printer route the guard uses
 * (printer.ts). The same picture is the on-screen preview, so what the guard
 * sees is exactly what prints.
 *
 * Layout follows the usual municipal parking-ticket form: issuing authority,
 * notice number and date, vehicle, offence (code, description, place, time),
 * the penalty and pay-by date, the issuing officer, a verification code,
 * payment/appeal terms and a signature line. The header is the AUTHORITY set
 * in Settings — never the software vendor.
 */
import QRCode from 'qrcode';
import { typeById, areaById, emirateById } from '../../shared/catalog.js';
import { fineFor } from './fines';

/** How a notice is laid out — set per phone in Settings → Fine printer. */
export interface NoticeLayout {
  paper: 58 | 80;
  authority: string;
  department: string;
  footer: string;
  payDays: number;
}

export const DEFAULT_FOOTER =
  'Pay the fine within the period shown at any authorised payment centre or online, quoting the notice number. ' +
  'Unpaid fines may attract additional charges. To object, submit an appeal within 15 days of issue.';
export const DEFAULT_LAYOUT: NoticeLayout = { paper: 58, authority: 'Municipal Parking Enforcement', department: 'Traffic & Parking Control Section', footer: DEFAULT_FOOTER, payDays: 30 };

/**
 * original   first notice handed to the driver (issues the fine)
 * duplicate  a reprint from the phone
 * office     a copy printed from the dashboard
 * preview    not issued — drawn with a NOT ISSUED stamp
 */
export type NoticeCopy = 'original' | 'duplicate' | 'office' | 'preview';

/**
 * Everything printed on the paper. Stored with every print on the server as a
 * snapshot, so the dashboard re-draws EXACTLY what the driver received — even
 * if the fine schedule, the record or the phone's settings change later.
 */
export interface Notice {
  ref: string;
  issuedAt: number;
  dueAt: number;
  observedAt: number;
  plate: { emirate: string; code: string; number: string };
  typeId: string;
  typeLabel: string;
  code: string;
  fine: number | null;
  details?: string;
  areaLabel: string;
  landmark: string;
  gps: { lat: number; lng: number; demo?: boolean } | null;
  officerName: string;
  officerId: string;
  photos: number;
  layout: NoticeLayout;
  copy: NoticeCopy;
  /** When this copy came off the printer (a reprint or office copy of an earlier notice). */
  printedAt?: number;
  specimen?: boolean;
}

/** The record fields a notice is built from — a phone record or a server violation. */
export interface NoticeSource {
  ref: string;
  type: string;
  plate: { emirate: string; code: string; number: string };
  location: { areaId: string; landmark: string; gps: { lat: number; lng: number; demo?: boolean } | null };
  notes?: string;
  guardName: string;
  guardId: string;
  capturedAt: number;
  photoCount: number;
}

export function buildNotice(r: NoticeSource, layout: NoticeLayout, copy: NoticeCopy, issuedAt = Date.now()): Notice {
  const t = typeById(r.type) as { label: string } | undefined;
  const f = fineFor(r.type); // the current schedule (server-set, cached for offline)
  return {
    ref: r.ref,
    issuedAt,
    dueAt: issuedAt + layout.payDays * 86_400_000,
    observedAt: r.capturedAt,
    plate: { emirate: r.plate.emirate, code: r.plate.code, number: r.plate.number },
    typeId: r.type,
    typeLabel: (t?.label ?? r.type).replace(/ \(describe in notes\)$/, ''),
    code: f.code,
    fine: f.fine,
    details: r.type === 'other' ? r.notes : undefined,
    areaLabel: (areaById(r.location.areaId) as { label: string } | undefined)?.label ?? '',
    landmark: r.location.landmark,
    gps: r.location.gps ? { lat: r.location.gps.lat, lng: r.location.gps.lng, demo: r.location.gps.demo } : null,
    officerName: r.guardName,
    officerId: r.guardId,
    photos: r.photoCount,
    layout: { ...layout },
    copy,
  };
}

/** Another copy of an issued notice: same numbers and dates, new label and print time. */
export const asCopy = (n: Notice, copy: NoticeCopy, printedAt = Date.now()): Notice => ({ ...n, copy, printedAt, specimen: false });

export function specimenNotice(officerName: string, officerId: string, layout: NoticeLayout): Notice {
  return {
    ...buildNotice(
      { ref: 'PV-TEST-0000', type: 'fire-lane', plate: { emirate: 'AD', code: '5', number: '12345' }, location: { areaId: 'khalidiyah', landmark: 'Test print', gps: { lat: 24.4718, lng: 54.3489, demo: true } }, guardName: officerName, guardId: officerId, capturedAt: Date.now() - 4 * 60_000, photoCount: 2 },
      layout,
      'original',
    ),
    specimen: true,
  };
}

export const fmtAed = (n: number | null | undefined) => (n == null ? 'To be assessed' : `AED ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = (n: number) => String(n).padStart(2, '0');
const date = (t: number) => {
  const d = new Date(t);
  return `${p2(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};
const time = (t: number) => {
  const d = new Date(t);
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
};
const money = (n: number) => `AED ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const plateText = (p: Notice['plate']) => [p.emirate && p.emirate !== 'OTH' ? p.emirate : '', p.code, p.number].filter(Boolean).join(' ');

const FONT = '"Lato", "Helvetica Neue", Arial, sans-serif';

/** A strip of paper we write down, top to bottom. */
class Strip {
  ctx: CanvasRenderingContext2D;
  y = 0;
  constructor(
    public c: HTMLCanvasElement,
    public W: number,
    public k: number, // scale: 1 at 384 dots (58 mm)
    public pad: number,
  ) {
    this.ctx = c.getContext('2d')!;
    this.ctx.fillStyle = '#fff';
    this.ctx.fillRect(0, 0, c.width, c.height);
    this.ctx.fillStyle = '#000';
    this.ctx.strokeStyle = '#000';
    this.ctx.textBaseline = 'top';
  }
  font(size: number, weight = 400) {
    this.ctx.font = `${weight} ${Math.round(size * this.k)}px ${FONT}`;
  }
  wrap(text: string, maxW: number): string[] {
    const out: string[] = [];
    for (const para of text.split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const test = line ? `${line} ${word}` : word;
        if (this.ctx.measureText(test).width <= maxW) {
          line = test;
          continue;
        }
        if (line) out.push(line);
        // A single word wider than the line (long refs): break it by characters.
        let w = word;
        while (this.ctx.measureText(w).width > maxW && w.length > 1) {
          let i = w.length - 1;
          while (i > 1 && this.ctx.measureText(w.slice(0, i)).width > maxW) i--;
          out.push(w.slice(0, i));
          w = w.slice(i);
        }
        line = w;
      }
      out.push(line);
    }
    return out;
  }
  text(text: string, { size = 19, weight = 400, align = 'left' as CanvasTextAlign, x = this.pad, w = this.W - 2 * this.pad, lh = 1.28, upper = false } = {}) {
    this.font(size, weight);
    this.ctx.textAlign = align;
    const ax = align === 'center' ? x + w / 2 : align === 'right' ? x + w : x;
    const lines = this.wrap(upper ? text.toUpperCase() : text, w);
    const step = Math.round(size * this.k * lh);
    for (const l of lines) {
      this.ctx.fillText(l, ax, this.y);
      this.y += step;
    }
    this.ctx.textAlign = 'left';
    return lines.length * step;
  }
  gap(h: number) {
    this.y += Math.round(h * this.k);
  }
  rule(kind: 'solid' | 'double' | 'dashed' | 'heavy' = 'solid') {
    const { ctx, pad, W, k } = this;
    const line = (yy: number, t: number) => ctx.fillRect(pad, yy, W - 2 * pad, Math.max(1, Math.round(t * k)));
    this.gap(4);
    if (kind === 'double') {
      line(this.y, 2);
      line(this.y + Math.round(5 * k), 2);
      this.y += Math.round(7 * k);
    } else if (kind === 'heavy') {
      line(this.y, 4);
      this.y += Math.round(4 * k);
    } else if (kind === 'dashed') {
      for (let x = pad; x < W - pad; x += Math.round(10 * k)) ctx.fillRect(x, this.y, Math.round(6 * k), Math.max(1, Math.round(2 * k)));
      this.y += Math.round(2 * k);
    } else {
      line(this.y, 1.5);
      this.y += Math.round(2 * k);
    }
    this.gap(6);
  }
  /** Section caption: small caps between rules — the form's "boxes". */
  section(title: string) {
    this.gap(2);
    this.font(15, 700);
    const t = title.toUpperCase();
    const tw = this.ctx.measureText(t).width;
    const mid = this.y + Math.round(9 * this.k);
    const gapX = Math.round(8 * this.k);
    this.ctx.fillRect(this.pad, mid, (this.W - tw) / 2 - this.pad - gapX, Math.max(1, Math.round(1.5 * this.k)));
    this.ctx.fillRect((this.W + tw) / 2 + gapX, mid, (this.W - tw) / 2 - this.pad - gapX, Math.max(1, Math.round(1.5 * this.k)));
    this.ctx.textAlign = 'center';
    this.ctx.fillText(t, this.W / 2, this.y + Math.round(1 * this.k));
    this.ctx.textAlign = 'left';
    this.y += Math.round(22 * this.k);
  }
  /** Label : value row — label column fixed, value wraps. */
  kv(label: string, value: string, { size = 19, weight = 700 } = {}) {
    const col = Math.round(118 * this.k);
    const top = this.y;
    this.font(16, 400);
    this.ctx.fillText(label, this.pad, top + Math.round((size - 16) * 0.6 * this.k));
    const h = this.text(value, { size, weight, x: this.pad + col, w: this.W - 2 * this.pad - col, lh: 1.22 });
    this.y = top + Math.max(h, Math.round(20 * this.k)) + Math.round(3 * this.k);
  }
  /** White text on a black bar — the notice title. */
  bar(lines: { t: string; size: number; weight?: number }[]) {
    const { ctx, pad, W, k } = this;
    const padY = Math.round(8 * k);
    let h = padY * 2;
    for (const l of lines) h += Math.round(l.size * k * 1.25);
    ctx.fillRect(pad, this.y, W - 2 * pad, h);
    ctx.fillStyle = '#fff';
    let yy = this.y + padY;
    ctx.textAlign = 'center';
    for (const l of lines) {
      this.font(l.size, l.weight ?? 700);
      ctx.fillText(l.t, W / 2, yy);
      yy += Math.round(l.size * k * 1.25);
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = '#000';
    this.y += h;
  }
  /** Bordered box — the fine amount. */
  box(draw: () => void) {
    const { ctx, pad, W, k } = this;
    const top = this.y;
    this.gap(10);
    draw();
    this.gap(8);
    const t = Math.max(2, Math.round(3 * k));
    ctx.fillRect(pad, top, W - 2 * pad, t);
    ctx.fillRect(pad, this.y, W - 2 * pad, t);
    ctx.fillRect(pad, top, t, this.y - top + t);
    ctx.fillRect(W - pad - t, top, t, this.y - top + t);
    this.y += t;
  }
  /** A plain, generic crest (shield + P) — deliberately no real emblem. */
  crest(size: number) {
    const { ctx, W, k } = this;
    const s = size * k;
    const x = W / 2 - s / 2;
    const y = this.y;
    const shield = (inset: number) => {
      ctx.beginPath();
      ctx.moveTo(x + inset, y + inset);
      ctx.lineTo(x + s - inset, y + inset);
      ctx.lineTo(x + s - inset, y + s * 0.5);
      ctx.quadraticCurveTo(x + s - inset, y + s * 0.85, x + s / 2, y + s * 1.12 - inset);
      ctx.quadraticCurveTo(x + inset, y + s * 0.85, x + inset, y + s * 0.5);
      ctx.closePath();
    };
    shield(0);
    ctx.fill();
    ctx.fillStyle = '#fff';
    shield(Math.round(4 * k));
    ctx.fill();
    ctx.fillStyle = '#000';
    shield(Math.round(7 * k));
    ctx.fill();
    ctx.fillStyle = '#fff';
    this.font(size * 0.56, 700);
    ctx.textAlign = 'center';
    ctx.fillText('P', W / 2, y + s * 0.16);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#000';
    this.y += Math.round(s * 1.12) + Math.round(8 * k);
  }
  qr(text: string, px: number) {
    const m = QRCode.create(text, { errorCorrectionLevel: 'M' }).modules;
    const cell = Math.max(2, Math.floor((px * this.k) / (m.size + 2)));
    const size = cell * (m.size + 2);
    const x0 = Math.round((this.W - size) / 2) + cell;
    const y0 = this.y + cell;
    for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) if (m.get(r, c)) this.ctx.fillRect(x0 + c * cell, y0 + r * cell, cell, cell);
    this.y += size + Math.round(4 * this.k);
  }
  /** Diagonal "SPECIMEN" style stamp over the finished strip. */
  stamp(word: string, y0: number, y1: number) {
    const { ctx, W, k } = this;
    ctx.save();
    ctx.translate(W / 2, (y0 + y1) / 2);
    ctx.rotate(-0.42);
    this.font(64, 700);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(2, Math.round(3 * k));
    ctx.strokeText(word, 0, 0);
    ctx.restore();
    ctx.textBaseline = 'top';
  }
}

let fontsReady: Promise<unknown> | null = null;
const loadFonts = () =>
  (fontsReady ||= Promise.all([document.fonts?.load(`700 20px ${FONT}`), document.fonts?.load(`400 20px ${FONT}`)]).catch(() => {}));

/** Draw the notice. Returns a pure black/white canvas at the printer's dot width. */
export async function renderNotice(n: Notice): Promise<HTMLCanvasElement> {
  const s = n.layout;
  await loadFonts();
  const W = s.paper === 80 ? 576 : 384;
  const k = W / 384;
  const tall = document.createElement('canvas');
  tall.width = W;
  tall.height = Math.round(2600 * k);
  const p = new Strip(tall, W, k, Math.round(8 * k));
  const emirate = emirateById(n.plate.emirate) as { label: string } | undefined;
  const dueAt = n.dueAt;
  const payDays = Math.round((n.dueAt - n.issuedAt) / 86_400_000);

  p.gap(6);
  p.crest(46);
  p.text(s.authority || 'Parking Enforcement', { size: 21, weight: 700, align: 'center', upper: true, lh: 1.2 });
  if (s.department) p.text(s.department, { size: 16, align: 'center', lh: 1.2 });
  p.gap(4);
  p.rule('double');
  p.bar([
    { t: 'PARKING VIOLATION', size: 25 },
    { t: 'PENALTY NOTICE', size: 20 },
  ]);
  p.gap(6);
  p.kv('Notice No.', n.ref, { size: 20 });
  p.kv('Date issued', `${date(n.issuedAt)}  ${time(n.issuedAt)}`);
  if (n.copy === 'duplicate' || n.copy === 'office') {
    p.gap(2);
    p.bar([{ t: n.copy === 'office' ? 'OFFICE COPY' : 'DUPLICATE COPY', size: 17 }]);
    if (n.printedAt) p.text(`Copy printed ${date(n.printedAt)}  ${time(n.printedAt)}`, { size: 14, align: 'center' });
    p.gap(4);
  }

  p.section('Vehicle');
  p.kv('Plate No.', plateText(n.plate) || 'Not recorded', { size: 26 });
  p.kv('Registered', emirate?.label ?? n.plate.emirate ?? '—');

  p.section('Offence');
  p.kv('Code', n.code || '—');
  p.kv('Offence', n.typeLabel);
  if (n.details) p.kv('Details', n.details, { size: 17, weight: 400 });
  p.kv('Observed', `${date(n.observedAt)}  ${time(n.observedAt)}`);
  p.kv('Location', [n.areaLabel, n.landmark].filter(Boolean).join(' · ') || '—');
  if (n.gps) p.kv('GPS', `${n.gps.lat.toFixed(5)}, ${n.gps.lng.toFixed(5)}${n.gps.demo ? ' (demo)' : ''}`, { size: 17, weight: 400 });
  p.kv('Evidence', `${n.photos} photograph${n.photos === 1 ? '' : 's'} on record`, { size: 17, weight: 400 });

  p.section('Penalty');
  p.box(() => {
    p.text('FINE AMOUNT', { size: 16, weight: 700, align: 'center' });
    p.gap(2);
    p.text(n.fine != null ? money(n.fine) : 'TO BE ASSESSED', { size: n.fine != null ? 34 : 26, weight: 700, align: 'center', lh: 1.15 });
  });
  p.gap(8);
  p.kv('Pay by', `${date(dueAt)}  (${payDays} days)`);

  p.section('Issuing officer');
  p.kv('Officer', n.officerName);
  p.kv('Officer ID', n.officerId.toUpperCase());

  p.gap(6);
  p.rule('dashed');
  p.qr(['PARKING PENALTY NOTICE', `No: ${n.ref}`, `Plate: ${plateText(n.plate)} (${n.plate.emirate})`, `Offence: ${n.code} ${n.typeLabel}`, `Fine: ${n.fine != null ? money(n.fine) : 'to be assessed'}`, `Issued: ${new Date(n.issuedAt).toISOString()}`, `Pay by: ${date(dueAt)}`].join('\n'), 176);
  p.text('Scan to verify this notice', { size: 15, align: 'center' });
  p.gap(4);
  p.rule('dashed');
  p.text(s.footer || '', { size: 15, lh: 1.3 });
  p.gap(22);
  p.font(15, 400);
  const sigW = Math.round(170 * k);
  p.ctx.fillRect(W - p.pad - sigW, p.y, sigW, Math.max(1, Math.round(1.5 * k)));
  p.gap(4);
  p.text("Officer's signature", { size: 14, align: 'right' });
  p.gap(6);
  p.rule('heavy');
  p.text('This notice was issued electronically and is valid without a stamp. Keep it for your records.', { size: 13, align: 'center', lh: 1.25 });
  p.gap(8);
  if (n.specimen) p.stamp('TEST PRINT', Math.round(200 * k), p.y - Math.round(120 * k));
  else if (n.copy === 'preview') p.stamp('NOT ISSUED', Math.round(200 * k), p.y - Math.round(120 * k));

  // Crop and force pure black/white (thermal printers have no grey).
  const out = document.createElement('canvas');
  out.width = W;
  out.height = Math.min(p.y, tall.height);
  const octx = out.getContext('2d')!;
  octx.drawImage(tall, 0, 0);
  const img = octx.getImageData(0, 0, out.width, out.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11 < 150 ? 0 : 255;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  octx.putImageData(img, 0, 0);
  return out;
}

/** Print the notice picture through the browser's print dialog (AirPrint, Android print service, office printer). */
export async function printImage(canvas: HTMLCanvasElement, widthMm: number) {
  let root = document.getElementById('pp-print-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'pp-print-root';
    document.body.appendChild(root);
  }
  const img = new Image();
  img.src = canvas.toDataURL('image/png');
  img.style.width = `${widthMm}mm`;
  img.alt = 'Penalty notice';
  root.replaceChildren(img);
  await img.decode().catch(() => {});
  window.print();
}

/** Save the notice picture as a PNG file. */
export function downloadImage(canvas: HTMLCanvasElement, name: string) {
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = `${name}.png`;
  a.click();
}
