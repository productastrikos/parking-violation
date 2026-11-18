/**
 * USB-cable handover — the format the phone and the laptop agree on.
 *
 * With no Wi-Fi and no internet, the only thing a plain phone shows a laptop
 * over a USB cable is its pictures: an iPhone shows its Photos (DCIM), an
 * Android phone its storage (Download, Pictures, DCIM). So the phone saves
 * each ticket as ONE picture ("ticket card"): readable by a person, with the
 * evidence photos drawn in, and a QR code that carries the ticket's data. The
 * laptop (the "Hub") reads the picture off the phone, decodes the QR, crops
 * the photos back out, and imports the ticket — no network, no app install.
 *
 * The QR holds ONE JSON object (ASCII only, so every QR reader decodes it the
 * same way). Photo positions are in card pixels; the card is CARD_WIDTH wide,
 * so a picture that was rescaled on the way can still be cropped correctly.
 */
import type { NoticeLayout } from './notice';

export const CABLE_TAG = 'PPCABLE1';
export const CARD_WIDTH = 1080;

export type PhotoKind = 'vehicle' | 'plate';
/** [kind, x, y, width, height] of a photo inside the card, in card pixels. */
export type PhotoBox = [PhotoKind, number, number, number, number];

export interface CableRecord {
  id: string;
  ref: string;
  type: string;
  severity: string;
  plate: { emirate: string; code: string; number: string; raw?: string; source?: string; confidence?: number };
  location: { areaId: string; landmark: string; gps: { lat: number; lng: number; accuracy?: number | null; demo?: boolean } | null };
  notes: string;
  guardId: string;
  guardName: string;
  deviceId: string;
  deviceLabel: string;
  capturedAt: number;
  capturedOffline: boolean;
}

/** The fine, when the guard has issued it (printed, or issued without paper).
 *  Only what is unique to the notice travels; the laptop rebuilds the full
 *  notice from the ticket (plate, place, officer…) — a smaller QR code has
 *  bigger squares, which survive a resized or re-compressed picture. */
export interface CableFine {
  opId: string; // the phone's op id — the laptop and the server log each notice once
  at: number;
  method: string;
  printer?: string;
  n: { ref: string; issuedAt: number; dueAt: number; code: string; fine: number | null; details?: string; layout: Omit<NoticeLayout, 'footer'> };
}

export interface CablePayload {
  t: typeof CABLE_TAG;
  ex: number; // when the picture was made (phone clock)
  rec: CableRecord;
  fine: CableFine | null;
  ph: PhotoBox[];
}

/** JSON with every non-ASCII character escaped, so QR byte mode carries plain ASCII. */
export const asciiJson = (v: unknown) => JSON.stringify(v).replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

/** Parse a decoded QR text; null when it is not a Park Patrol ticket card. */
export function parseCablePayload(text: string | null | undefined): CablePayload | null {
  if (!text || !text.includes(CABLE_TAG)) return null;
  try {
    const p = JSON.parse(text) as CablePayload;
    if (p?.t !== CABLE_TAG || !p.rec?.id || !p.rec.type || !Array.isArray(p.ph)) return null;
    return p;
  } catch {
    return null;
  }
}
