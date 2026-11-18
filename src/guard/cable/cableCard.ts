/**
 * The ticket card: ONE picture per ticket, saved on the phone so a laptop can
 * read it over a USB cable (see src/lib/cable.ts for why a picture).
 *
 * Top to bottom: header, ticket number + fine status, plate, offence and fine,
 * the evidence photos, the details, and a large QR code with the ticket data.
 * Everything is drawn locally — it works with no network at all.
 */
import QRCode from 'qrcode';
import { areaOf, emirateOf, typeOf } from '../../lib/api';
import { fmtAed, plateText } from '../../lib/notice';
import { fineFor } from '../../lib/fines';
import { CABLE_TAG, CARD_WIDTH, asciiJson, type CableFine, type CablePayload, type PhotoBox, type PhotoKind } from '../../lib/cable';
import { firstNoticeOp, photosFor, type LocalRecord } from '../offline/db';

const FONT = '"Lato", "Helvetica Neue", Arial, sans-serif';
const W = CARD_WIDTH;
const P = 54; // side margin
const QR_PX = 940; // target QR width — large modules survive any re-encoding on the way to the laptop

const two = (n: number) => String(n).padStart(2, '0');
export const when = (t: number) => {
  const d = new Date(t);
  return `${two(d.getDate())} ${d.toLocaleString('en-GB', { month: 'short' })} ${d.getFullYear()}  ${two(d.getHours())}:${two(d.getMinutes())}`;
};
const round = (n: number | null | undefined, dp = 6) => (n == null ? n : Math.round(n * 10 ** dp) / 10 ** dp);

function loadPhoto(buf: ArrayBuffer, type: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([buf], { type }));
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read a photo'));
    };
    img.src = url;
  });
}

export function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines = 3): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= maxW || !line) line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const cut = lines.slice(0, maxLines);
    cut[maxLines - 1] = `${cut[maxLines - 1].replace(/\s+\S*$/, '')} …`;
    return cut;
  }
  return lines;
}

/** The fine as issued on this phone, or null when it has not been issued yet. */
async function issuedFine(rec: LocalRecord): Promise<CableFine | null> {
  if (!rec.firstNotice) return null;
  const op = await firstNoticeOp(rec.id);
  const n = op?.notice?.notice ?? rec.firstNotice;
  const { footer: _footer, ...layout } = n.layout;
  return {
    opId: op?.id ?? `${rec.id}-notice-1`,
    at: op?.notice?.at ?? rec.firstNotice.issuedAt,
    method: op?.notice?.method ?? 'unknown',
    ...(op?.notice?.printer ? { printer: op.notice.printer } : {}),
    n: { ref: n.ref, issuedAt: n.issuedAt, dueAt: n.dueAt, code: n.code, fine: n.fine, ...(n.details ? { details: n.details } : {}), layout },
  };
}

export interface TicketCard {
  canvas: HTMLCanvasElement;
  payload: CablePayload;
}

export async function renderCableCard(rec: LocalRecord): Promise<TicketCard> {
  await Promise.all([document.fonts?.load(`700 40px ${FONT}`), document.fonts?.load(`400 30px ${FONT}`)]).catch(() => {});
  const fine = await issuedFine(rec);
  const photos = await photosFor(rec.id);

  const tall = document.createElement('canvas');
  tall.width = W;
  tall.height = 4400;
  const ctx = tall.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, tall.height);
  ctx.textBaseline = 'top';
  const font = (size: number, weight = 400) => (ctx.font = `${weight} ${size}px ${FONT}`);
  const text = (t: string, x: number, y: number, size: number, weight = 400, color = '#0f172a', align: CanvasTextAlign = 'left') => {
    font(size, weight);
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(t, x, y);
    ctx.textAlign = 'left';
  };

  // Header band
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, W, 176);
  text('PARK PATROL', P, 38, 52, 800, '#ffffff');
  text('Ticket for USB-cable transfer to the laptop', P, 108, 30, 400, '#cbd5e1');
  let y = 214;

  // Ticket number + fine status pill
  text(`Ticket ${rec.ref}`, P, y + 6, 32, 700, '#334155');
  const pill = fine ? 'FINE ISSUED' : 'FINE NOT ISSUED YET';
  font(26, 800);
  const pw = ctx.measureText(pill).width + 44;
  ctx.fillStyle = fine ? '#dcfce7' : '#fef3c7';
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(W - P - pw, y, pw, 50, 25);
  else ctx.rect(W - P - pw, y, pw, 50); // iOS 15
  ctx.fill();
  text(pill, W - P - pw / 2, y + 12, 26, 800, fine ? '#166534' : '#92400e', 'center');
  y += 84;

  // Plate
  const plate = rec.server?.plate ?? rec.plate;
  text(plateText(plate) || 'Plate not recorded', P, y, 88, 800, '#000');
  y += 104;
  text(`${emirateOf(plate.emirate)?.label ?? plate.emirate ?? ''} plate${plate.source === 'ocr' ? ' · read by the plate reader' : ''}`, P, y, 28, 400, '#475569');
  y += 58;

  // Offence + fine
  const type = typeOf(rec.server?.type ?? rec.type);
  font(40, 700);
  for (const l of wrap(ctx, type?.label ?? rec.type, W - 2 * P, 2)) {
    text(l, P, y, 40, 700);
    y += 50;
  }
  y += 6;
  if (fine) {
    text(fmtAed(fine.n.fine), P, y, 60, 800, '#000');
    y += 72;
    text(`Offence code ${fine.n.code || '—'} · issued ${when(fine.at)} · pay by ${when(fine.n.dueAt).slice(0, 11)}`, P, y, 26, 400, '#475569');
  } else {
    const f = fineFor(rec.server?.type ?? rec.type);
    text(`Schedule fine: ${fmtAed(f.fine)}`, P, y, 44, 700, '#334155');
    y += 58;
    text('Not issued on the phone — the control room can issue it', P, y, 26, 400, '#92400e');
  }
  y += 56;

  // Evidence photos, drawn in so the laptop can crop them back out
  const boxes: PhotoBox[] = [];
  const order: PhotoKind[] = ['vehicle', 'plate'];
  for (const kind of order) {
    const p = photos.find((x) => x.kind === kind);
    if (!p) continue;
    let img: HTMLImageElement;
    try {
      img = await loadPhoto(p.buf, p.type);
    } catch {
      continue;
    }
    const maxW = W - 2 * P;
    const maxH = kind === 'vehicle' ? 700 : 380;
    const s = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1.5);
    const w = Math.round(img.naturalWidth * s);
    const h = Math.round(img.naturalHeight * s);
    const x = Math.round((W - w) / 2);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
    ctx.drawImage(img, x, y, w, h);
    boxes.push([kind, x, y, w, h]);
    y += h + 12;
    text(kind === 'vehicle' ? 'Vehicle photo' : 'Plate close-up', W / 2, y, 24, 400, '#64748b', 'center');
    y += 48;
  }

  // Details
  const rows: [string, string][] = [
    ['Recorded', `${when(rec.capturedAt)}${rec.capturedOffline ? '  (offline, no network)' : ''}`],
    ['Location', [areaOf(rec.location.areaId)?.label, rec.location.landmark].filter(Boolean).join(' · ') || '—'],
  ];
  if (rec.location.gps) rows.push(['GPS', `${rec.location.gps.lat.toFixed(5)}, ${rec.location.gps.lng.toFixed(5)}${rec.location.gps.demo ? ' (demo)' : ''}`]);
  rows.push(['Officer', `${rec.guardName} (${rec.guardId})`], ['Phone', rec.deviceLabel || '—']);
  if (rec.notes) rows.push(['Notes', rec.notes]);
  for (const [k, v] of rows) {
    text(k, P, y, 28, 700, '#475569');
    font(28, 400);
    const lines = wrap(ctx, v, W - 2 * P - 190, k === 'Notes' ? 3 : 2);
    for (const l of lines) {
      text(l, P + 190, y, 28, 400, '#0f172a');
      y += 38;
    }
    y += 8;
  }
  y += 16;

  // The data, as a QR code
  const payload: CablePayload = {
    t: CABLE_TAG,
    ex: Date.now(),
    rec: {
      id: rec.id,
      ref: rec.ref,
      type: rec.server?.type ?? rec.type,
      severity: rec.severity,
      plate: { emirate: plate.emirate, code: plate.code, number: plate.number, source: plate.source, ...(plate.confidence != null ? { confidence: Math.round(plate.confidence) } : {}) },
      location: {
        areaId: rec.location.areaId,
        landmark: rec.location.landmark,
        gps: rec.location.gps ? { lat: round(rec.location.gps.lat)!, lng: round(rec.location.gps.lng)!, accuracy: rec.location.gps.accuracy != null ? Math.round(rec.location.gps.accuracy) : null, demo: Boolean(rec.location.gps.demo) } : null,
      },
      notes: rec.notes.slice(0, 300),
      guardId: rec.guardId,
      guardName: rec.guardName,
      deviceId: rec.deviceId,
      deviceLabel: rec.deviceLabel,
      capturedAt: rec.capturedAt,
      capturedOffline: rec.capturedOffline,
    },
    fine,
    ph: boxes,
  };
  ctx.setLineDash([14, 10]);
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(P, y);
  ctx.lineTo(W - P, y);
  ctx.stroke();
  ctx.setLineDash([]);
  y += 30;
  const m = QRCode.create(asciiJson(payload), { errorCorrectionLevel: 'M' }).modules;
  const cell = Math.max(4, Math.floor(QR_PX / (m.size + 8)));
  const size = cell * (m.size + 8); // 4-module white quiet zone on every side
  const qx = Math.round((W - size) / 2);
  ctx.fillStyle = '#fff';
  ctx.fillRect(qx, y, size, size);
  ctx.fillStyle = '#000';
  for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) if (m.get(r, c)) ctx.fillRect(qx + (c + 4) * cell, y + (r + 4) * cell, cell, cell);
  y += size + 18;
  text('The laptop reads this code. Keep the whole picture — do not crop or edit it.', W / 2, y, 25, 400, '#334155', 'center');
  y += 40;
  text(`Saved on this phone with no network · picture made ${when(payload.ex)}`, W / 2, y, 23, 400, '#64748b', 'center');
  y += 56;

  const out = document.createElement('canvas');
  out.width = W;
  out.height = y;
  out.getContext('2d')!.drawImage(tall, 0, 0);
  tall.width = tall.height = 1; // free the big canvas at once (iOS keeps canvas memory tight)
  return { canvas: out, payload };
}

export const cardFileName = (rec: LocalRecord) => `ParkPatrol-${rec.ref.replace(/[^A-Za-z0-9-]/g, '')}.png`;

export const canvasToPng = (c: HTMLCanvasElement) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not create the picture'))), 'image/png'));
