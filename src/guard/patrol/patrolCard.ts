/**
 * The patrol report as ONE picture — handed to the laptop over the USB cable
 * exactly like a ticket (see src/lib/cable.ts): readable by a person (route
 * sketch, checkpoints reached and missed, times) and a QR code with the data
 * (PPPATROL1) that the laptop's "Receive from phone" reads.
 */
import QRCode from 'qrcode';
import { CARD_WIDTH, asciiJson } from '../../lib/cable';
import { PATROL_TAG, type PatrolPayload, type PatrolRoute } from '../../lib/patrol';
import { when } from '../cable/cableCard';
import type { LocalReport } from './patrolStore';

const FONT = '"Lato", "Helvetica Neue", Arial, sans-serif';
const W = CARD_WIDTH;
const P = 54;
const two = (n: number) => String(n).padStart(2, '0');
const hm = (t: number) => {
  const d = new Date(t);
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
};

export async function renderPatrolCard(rep: LocalReport, route: PatrolRoute | null): Promise<{ canvas: HTMLCanvasElement; payload: PatrolPayload }> {
  await Promise.all([document.fonts?.load(`700 40px ${FONT}`), document.fonts?.load(`400 30px ${FONT}`)]).catch(() => {});
  const tall = document.createElement('canvas');
  tall.width = W;
  tall.height = 4200;
  const ctx = tall.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, tall.height);
  ctx.textBaseline = 'top';
  const text = (t: string, x: number, y: number, size: number, weight = 400, color = '#0f172a', align: CanvasTextAlign = 'left') => {
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(t, x, y);
    ctx.textAlign = 'left';
  };

  ctx.fillStyle = '#1e1b4b';
  ctx.fillRect(0, 0, W, 176);
  text('PARK PATROL · PATROL REPORT', P, 38, 46, 800, '#ffffff');
  text('For USB-cable transfer to the laptop', P, 108, 30, 400, '#c7d2fe');
  let y = 214;

  const reached = new Map(rep.visits.map((v) => [v.cp, v]));
  const done = reached.size;
  const complete = done >= rep.total && rep.total > 0;
  text(rep.routeName, P, y, 50, 800, '#000');
  y += 66;
  text(`${rep.guardName} (${rep.guardId}) · ${rep.date}`, P, y, 30, 400, '#334155');
  y += 46;
  text(`Started ${hm(rep.startedAt)} · ${rep.finishedAt ? `finished ${hm(rep.finishedAt)}` : 'still in progress'}`, P, y, 30, 400, '#334155');
  y += 64;
  text(`${done} of ${rep.total} checkpoints`, P, y, 56, 800, complete ? '#166534' : '#9a3412');
  const pill = complete ? 'COMPLETE' : 'INCOMPLETE';
  ctx.font = `800 26px ${FONT}`;
  const pw = ctx.measureText(pill).width + 44;
  ctx.fillStyle = complete ? '#dcfce7' : '#ffedd5';
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(W - P - pw, y + 10, pw, 50, 25);
  else ctx.rect(W - P - pw, y + 10, pw, 50);
  ctx.fill();
  text(pill, W - P - pw / 2, y + 22, 26, 800, complete ? '#166534' : '#9a3412', 'center');
  y += 96;

  // Route sketch: checkpoints projected into a box, reached green, missed red.
  const cps = route?.checkpoints ?? [];
  if (cps.length >= 2) {
    const boxW = W - 2 * P;
    const boxH = 520;
    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(P, y, boxW, boxH);
    const lat0 = cps.reduce((s, c) => s + c.lat, 0) / cps.length;
    const kx = Math.cos((lat0 * Math.PI) / 180);
    const xs = cps.map((c) => c.lng * kx);
    const ys = cps.map((c) => c.lat);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const s = Math.min((boxW - 120) / Math.max(1e-6, maxX - minX), (boxH - 120) / Math.max(1e-6, maxY - minY));
    const px = (i: number) => P + boxW / 2 + (xs[i] - (minX + maxX) / 2) * s;
    const py = (i: number) => y + boxH / 2 - (ys[i] - (minY + maxY) / 2) * s;
    ctx.strokeStyle = '#7c3aed';
    ctx.lineWidth = 6;
    ctx.setLineDash([18, 12]);
    ctx.beginPath();
    cps.forEach((_, i) => (i ? ctx.lineTo(px(i), py(i)) : ctx.moveTo(px(i), py(i))));
    if (route?.loop && cps.length > 2) ctx.lineTo(px(0), py(0));
    ctx.stroke();
    ctx.setLineDash([]);
    cps.forEach((_, i) => {
      ctx.fillStyle = reached.has(i) ? '#16a34a' : '#dc2626';
      ctx.beginPath();
      ctx.arc(px(i), py(i), 26, 0, Math.PI * 2);
      ctx.fill();
      text(String(i + 1), px(i), py(i) - 15, 28, 800, '#fff', 'center');
    });
    y += boxH + 30;
  }

  // Checkpoint list
  for (let i = 0; i < rep.total; i++) {
    const v = reached.get(i);
    const label = cps[i]?.label || `Checkpoint ${i + 1}`;
    text(`${i + 1}. ${label}`.slice(0, 44), P, y, 30, 700, '#0f172a');
    text(v ? `${hm(v.at)} · ${v.how === 'gps' ? 'GPS' : v.how === 'demo' ? 'demo GPS' : 'tapped'}` : 'missed', W - P, y, 30, v ? 400 : 700, v ? '#166534' : '#b91c1c', 'right');
    y += 46;
  }
  y += 24;

  const { updatedAt: _u, cableExportedAt: _c, uploadedAt: _p, ...clean } = rep;
  const payload: PatrolPayload = { t: PATROL_TAG, rep: clean };
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
  const cell = Math.max(4, Math.floor(940 / (m.size + 8)));
  const size = cell * (m.size + 8);
  const qx = Math.round((W - size) / 2);
  ctx.fillStyle = '#000';
  for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) if (m.get(r, c)) ctx.fillRect(qx + (c + 4) * cell, y + (r + 4) * cell, cell, cell);
  y += size + 18;
  text('The laptop reads this code. Keep the whole picture — do not crop or edit it.', W / 2, y, 25, 400, '#334155', 'center');
  y += 40;
  text(`Saved on this phone with no network · picture made ${when(Date.now())}`, W / 2, y, 23, 400, '#64748b', 'center');
  y += 56;

  const out = document.createElement('canvas');
  out.width = W;
  out.height = Math.max(y, Math.round(W * 1.5)); // stays "tall" — the laptop skips square camera photos quickly
  const octx = out.getContext('2d')!;
  octx.fillStyle = '#fff';
  octx.fillRect(0, 0, out.width, out.height);
  octx.drawImage(tall, 0, 0);
  tall.width = tall.height = 1;
  return { canvas: out, payload };
}

export const patrolFileName = (rep: LocalReport) => `ParkPatrol-patrol-${rep.date}-${rep.routeName.replace(/[^A-Za-z0-9]+/g, '-').slice(0, 30)}.png`;
