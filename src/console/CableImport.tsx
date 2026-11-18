/**
 * Receive from phone (USB cable) — the laptop side of the no-network handover.
 *
 * The phone saved each ticket as a picture (src/guard/cable/cableCard.ts). With
 * the phone plugged in, the laptop sees those pictures: an iPhone's Photos
 * (This PC › Apple iPhone › Internal Storage › DCIM) or an Android phone's
 * storage (This PC › phone › Internal storage › Download). The supervisor picks
 * them here — or drags them in — and for each picture this panel:
 *
 *   1. decodes the QR code (jsQR, entirely in this browser — no network);
 *   2. crops the evidence photos back out of the picture;
 *   3. posts the ticket to this laptop's server (POST /api/cable/import),
 *      which stores it once and logs the fine the guard issued.
 *
 * Other photos picked by mistake are skipped quickly (wrong shape or no code).
 */
import { useRef, useState } from 'react';
import jsQR from 'jsqr';
import { AlertTriangle, CheckCircle2, FolderOpen, Loader2, Repeat, Smartphone, Usb, Image as ImageIcon } from 'lucide-react';
import { areaOf, request, typeOf, type Violation } from '../lib/api';
import { CARD_WIDTH, parseCablePayload, type CablePayload, type PhotoKind } from '../lib/cable';
import { DEFAULT_FOOTER, fmtAed, plateText, type Notice } from '../lib/notice';
import { parsePatrolPayload, type PatrolPayload, type PatrolReport } from '../lib/patrol';

/** Store one patrol report on this laptop's server (repeats merge). */
export const importPatrol = (token: string, p: PatrolPayload) =>
  request<{ patrol: PatrolReport; created: boolean }>('/api/cable/patrol', { method: 'POST', token, body: JSON.stringify(p) });
import { Modal } from './parts';

export interface TicketPicture {
  payload: CablePayload;
  photos: { kind: PhotoKind; blob: Blob }[];
}

export interface CableImportResult {
  violation: Violation;
  created: boolean;
  duplicate: boolean;
  fine: { amount: number | null; logged: boolean; error?: string } | null;
  guardKnown: boolean;
  /** Photos re-attached to a ticket that was already here but whose photo files were missing. */
  photosRestored?: number;
}

function scan(src: ImageBitmap, region: { y: number; h: number } | null, scale = 1) {
  const sy = region?.y ?? 0;
  const sh = region?.h ?? src.height;
  const cw = Math.round(src.width * scale);
  const ch = Math.round(sh * scale);
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(src, 0, sy, src.width, sh, 0, 0, cw, ch);
  const d = ctx.getImageData(0, 0, cw, ch);
  return jsQR(d.data, cw, ch, { inversionAttempts: 'dontInvert' });
}

/** Read one picture off the phone. Returns the ticket, a patrol report, or why the picture was skipped. */
export async function readTicketPicture(file: Blob): Promise<TicketPicture | { patrol: PatrolPayload } | { skip: string }> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    return { skip: 'Not a picture this browser can open (an iPhone HEIC photo or a video)' };
  }
  try {
    const { width: w, height: h } = bmp;
    // Ticket pictures are tall (about 1080 × 3000). Ordinary camera photos are skipped without a slow scan.
    if (w < 480 || h / w < 1.4) return { skip: 'Not a Park Patrol ticket picture' };
    const lower = Math.round(h * 0.45);
    const tries = [
      () => scan(bmp, { y: lower, h: h - lower }), // the code sits in the lower half
      () => scan(bmp, null),
      ...(w < 900 ? [() => scan(bmp, { y: lower, h: h - lower }, 2)] : [() => scan(bmp, null, 0.5)]), // a shrunk picture reads better enlarged
    ];
    let payload: CablePayload | null = null;
    for (const t of tries) {
      const text = t()?.data;
      payload = parseCablePayload(text);
      if (payload) break;
      const patrol = parsePatrolPayload(text);
      if (patrol) return { patrol };
    }
    if (!payload) return { skip: 'No ticket code found in this picture' };

    // Crop the evidence photos back out (positions are in card pixels; scale if the picture was resized).
    const k = w / CARD_WIDTH;
    const photos: TicketPicture['photos'] = [];
    for (const [kind, x, y, pw, ph] of payload.ph) {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(pw * k));
      c.height = Math.max(1, Math.round(ph * k));
      c.getContext('2d')!.drawImage(bmp, x * k, y * k, pw * k, ph * k, 0, 0, c.width, c.height);
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.9));
      if (blob) photos.push({ kind, blob });
    }
    return { payload, photos };
  } finally {
    bmp.close();
  }
}

/** The full penalty notice as the guard issued it: the code carries what is unique to the
 *  notice, the rest comes from the ticket (the same sources the phone built it from). */
export function noticeOf(p: CablePayload): Notice | null {
  const f = p.fine;
  if (!f) return null;
  const r = p.rec;
  return {
    ref: f.n.ref,
    issuedAt: f.n.issuedAt,
    dueAt: f.n.dueAt,
    observedAt: r.capturedAt,
    plate: { emirate: r.plate.emirate, code: r.plate.code, number: r.plate.number },
    typeId: r.type,
    typeLabel: (typeOf(r.type)?.label ?? r.type).replace(/ \(describe in notes\)$/, ''),
    code: f.n.code,
    fine: f.n.fine,
    details: f.n.details,
    areaLabel: areaOf(r.location.areaId)?.label ?? '',
    landmark: r.location.landmark,
    gps: r.location.gps ? { lat: r.location.gps.lat, lng: r.location.gps.lng, demo: r.location.gps.demo } : null,
    officerName: r.guardName,
    officerId: r.guardId,
    photos: p.ph.length,
    layout: { ...f.n.layout, footer: DEFAULT_FOOTER },
    copy: 'original',
  };
}

/** Store one ticket on this laptop's server. Safe to repeat — the same ticket is kept once. */
export function importTicket(token: string, t: TicketPicture) {
  const p = t.payload;
  const { n: _n, ...fine } = p.fine ?? { n: null };
  const payload = { ...p, fine: p.fine ? { ...fine, notice: noticeOf(p) } : null };
  const fd = new FormData();
  fd.append('payload', JSON.stringify(payload));
  for (const ph of t.photos) fd.append(ph.kind, ph.blob, `${ph.kind}.jpg`);
  return request<CableImportResult>('/api/cable/import', { method: 'POST', token, body: fd, timeoutMs: 60_000 });
}

type RowState = 'reading' | 'importing' | 'imported' | 'duplicate' | 'skipped' | 'error';
interface Row {
  key: string;
  name: string;
  state: RowState;
  text?: string;
  ref?: string;
  plate?: string;
  fine?: string;
  guard?: string;
  id?: string;
}

const isPicture = (f: File) => /^image\//.test(f.type) || /\.(png|jpe?g|heic|heif|webp)$/i.test(f.name);

export function CableImport({ token, onClose, onOpen }: { token: string; onClose: () => void; onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function run(all: File[]) {
    const files = all.filter(isPicture);
    if (!files.length || busy) return;
    setBusy(true);
    const base = Date.now();
    const batch: Row[] = files.map((f, i) => ({ key: `${base}-${i}`, name: f.name, state: 'reading' }));
    setRows((r) => [...batch, ...r]);
    const upd = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    for (let i = 0; i < files.length; i++) {
      const key = batch[i].key;
      try {
        const t = await readTicketPicture(files[i]);
        if ('skip' in t) {
          upd(key, { state: 'skipped', text: t.skip });
          continue;
        }
        if ('patrol' in t) {
          const rep = t.patrol.rep;
          const reached = new Set(rep.visits.map((v) => v.cp)).size;
          upd(key, { state: 'importing', plate: `Patrol · ${rep.routeName}`, guard: rep.guardName });
          const r = await importPatrol(token, t.patrol);
          upd(key, {
            state: r.created ? 'imported' : 'duplicate',
            fine: `${reached}/${rep.total} checkpoints`,
            text: r.created ? `Patrol report imported · ${rep.guardName} · ${rep.date}` : 'Already on this laptop — the report was brought up to date',
          });
          continue;
        }
        const p = t.payload;
        upd(key, { state: 'importing', ref: p.rec.ref, plate: plateText(p.rec.plate) || 'No plate', guard: p.rec.guardName });
        const r = await importTicket(token, t);
        upd(key, {
          state: r.created ? 'imported' : 'duplicate',
          id: r.violation.id,
          fine: p.fine ? `Fine ${fmtAed(p.fine.n.fine)}` : 'Fine not issued on the phone',
          text: r.created
            ? r.guardKnown
              ? undefined
              : `${p.rec.guardName} is not on this laptop's team list — kept under that name`
            : `Already on this laptop${r.fine?.logged ? ' — the fine was added' : ''}${r.photosRestored ? ` — ${r.photosRestored} missing photo${r.photosRestored > 1 ? 's' : ''} restored` : ''}`,
        });
      } catch (e) {
        upd(key, { state: 'error', text: (e as Error).message });
      }
    }
    setBusy(false);
  }

  const shown = rows.filter((r) => r.state !== 'skipped');
  const skipped = rows.filter((r) => r.state === 'skipped');
  const imported = rows.filter((r) => r.state === 'imported').length;
  const dupes = rows.filter((r) => r.state === 'duplicate').length;
  const errors = rows.filter((r) => r.state === 'error').length;

  return (
    <Modal title="Receive from phone — USB cable" onClose={onClose} wide>
      <p className="muted" style={{ marginTop: 0 }}>
        No network needed. The phone saved its tickets as pictures. Connect it to this laptop with a USB cable, then pick those pictures here.
      </p>

      <div className="cable-steps">
        <div className="cable-step">
          <span className="cable-step-no">1</span>
          <div>
            <b>On the phone</b>
            <div className="faint">Home → Send to laptop by cable → save the pictures.</div>
          </div>
        </div>
        <div className="cable-step">
          <span className="cable-step-no">2</span>
          <div>
            <b>Connect the cable</b>
            <div className="faint">iPhone: unlock it and tap Allow (or Trust). Android: tap the USB notice → File transfer.</div>
          </div>
        </div>
        <div className="cable-step">
          <span className="cable-step-no">3</span>
          <div>
            <b>Pick the pictures</b>
            <div className="faint">
              iPhone: This PC › Apple iPhone › Internal Storage › DCIM. Android: This PC › your phone › Internal storage › Pictures › ParkPatrol (Park Patrol app) or Download (Chrome). Select all — other photos are skipped.
            </div>
          </div>
        </div>
      </div>

      <div
        className={`cable-drop${drag ? ' is-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void run([...e.dataTransfer.files]);
        }}
      >
        <Usb size={30} className="cable-drop-icon" />
        <button className="btn btn-primary" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? <Loader2 size={16} className="spin" /> : <FolderOpen size={16} />} {busy ? 'Reading pictures…' : 'Choose pictures from the phone'}
        </button>
        <div className="faint" style={{ fontSize: 12.5 }}>
          or drag them here · on a Mac, copy them off with Image Capture (iPhone) or Android File Transfer first
        </div>
        <input
          ref={input}
          type="file"
          accept="image/*,.png,.jpg,.jpeg,.heic"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            void run(files);
          }}
        />
      </div>

      {rows.length > 0 && (
        <div className="cable-summary" role="status">
          {busy && <Loader2 size={15} className="spin" />}
          <span>
            <b>{imported}</b> imported
          </span>
          {dupes > 0 && <span>· {dupes} already on this laptop</span>}
          {skipped.length > 0 && <span>· {skipped.length} other picture{skipped.length === 1 ? '' : 's'} skipped</span>}
          {errors > 0 && <span className="cable-err">· {errors} failed</span>}
        </div>
      )}

      {shown.length > 0 && (
        <div className="cable-rows">
          {shown.map((r) => (
            <div key={r.key} className={`cable-row is-${r.state}`}>
              <span className="cable-row-icon">
                {r.state === 'reading' || r.state === 'importing' ? (
                  <Loader2 size={17} className="spin" />
                ) : r.state === 'imported' ? (
                  <CheckCircle2 size={17} />
                ) : r.state === 'duplicate' ? (
                  <Repeat size={17} />
                ) : (
                  <AlertTriangle size={17} />
                )}
              </span>
              <div className="cable-row-main">
                <div className="cable-row-top">
                  {r.plate ? <b>{r.plate}</b> : <span className="mono">{r.name}</span>}
                  {r.ref && <span className="faint mono">{r.ref}</span>}
                  {r.fine && <span className={`chip ${r.fine.startsWith('Fine AED') ? 'chip-success' : ''}`}>{r.fine}</span>}
                </div>
                <div className="faint" style={{ fontSize: 12.5 }}>
                  {r.state === 'reading'
                    ? 'Reading the picture…'
                    : r.state === 'importing'
                      ? 'Importing…'
                      : r.text ?? (r.state === 'imported' ? `Imported${r.guard ? ` · recorded by ${r.guard}` : ''} · ${r.name}` : r.name)}
                </div>
              </div>
              {r.id && (
                <button className="btn btn-sm" onClick={() => onOpen(r.id!)}>
                  Open
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {skipped.length > 0 && (
        <details className="cable-skipped">
          <summary>
            <ImageIcon size={14} /> {skipped.length} picture{skipped.length === 1 ? '' : 's'} skipped
          </summary>
          <ul>
            {skipped.map((r) => (
              <li key={r.key}>
                <span className="mono">{r.name}</span> — {r.text}
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="faint" style={{ fontSize: 12, marginBottom: 0, display: 'flex', gap: 6, alignItems: 'center' }}>
        <Smartphone size={13} /> Tickets keep the phone's capture time, GPS, photos and the fine the guard issued. Importing the same picture twice is safe.
      </p>
    </Modal>
  );
}
