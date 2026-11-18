/**
 * Patrol routes — set in the control room, walked by the guard, reported back.
 *
 *   ROUTE   a named, ordered list of checkpoints for one guard, with the days and
 *           shift hours it runs (0 = Sunday … 6 = Saturday) and how close (m)
 *           counts as "reached".
 *   REPORT  one guard's walk of one route on one day: which checkpoints were
 *           reached, when, and how (GPS, tapped, or demo GPS).
 *
 * With no network, routes reach the phone as a QR CODE on the dashboard that the
 * guard scans (PPROUTE1 — works on iPhone and Android; the USB cable only carries
 * data from the phone to the laptop). Reports come back with the tickets over the
 * cable, as a picture with a QR code (PPPATROL1, see src/lib/cable.ts).
 * Online phones also get routes in their field pack and upload reports directly.
 */
import { asciiJson } from './cable';

export interface Checkpoint {
  id: string;
  lat: number;
  lng: number;
  label: string;
}

export interface PatrolRoute {
  id: string;
  name: string;
  guardId: string;
  areaId: string;
  checkpoints: Checkpoint[];
  /** Back to the first checkpoint at the end. */
  loop: boolean;
  days: number[];
  start: string; // "06:00"
  end: string; // "14:00"
  radiusM: number;
  active: boolean;
  updatedAt: number;
  updatedBy?: string;
}

export type VisitHow = 'gps' | 'manual' | 'demo';
export interface PatrolVisit {
  cp: number; // checkpoint index
  at: number;
  how: VisitHow;
}

export interface PatrolReport {
  id: string;
  routeId: string;
  routeName: string;
  guardId: string;
  guardName: string;
  date: string; // YYYY-MM-DD, the phone's local day
  startedAt: number;
  finishedAt: number | null;
  total: number;
  visits: PatrolVisit[];
  deviceId: string;
  deviceLabel: string;
  receivedAt?: number;
  via?: 'cable' | 'network';
}

export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const ROUTE_COLORS = ['#7c3aed', '#0891b2', '#ea580c', '#16a34a', '#db2777', '#2563eb', '#ca8a04'];

const two = (n: number) => String(n).padStart(2, '0');
export const dayKey = (t = Date.now()) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
};
export const daysText = (days: number[]) =>
  days.length === 7 ? 'Every day' : [0, 1, 2, 3, 4].every((d) => days.includes(d)) && days.length === 5 ? 'Sun–Thu' : [1, 2, 3, 4, 5].every((d) => days.includes(d)) && days.length === 5 ? 'Mon–Fri' : days.map((d) => DAY_SHORT[d]).join(', ');
export const runsOn = (r: PatrolRoute, t = Date.now()) => r.active && r.days.includes(new Date(t).getDay());

/** Metres between two points (haversine). */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
export const routeLengthM = (r: Pick<PatrolRoute, 'checkpoints' | 'loop'>) => {
  const c = r.checkpoints;
  let m = 0;
  for (let i = 1; i < c.length; i++) m += distanceM(c[i - 1], c[i]);
  if (r.loop && c.length > 2) m += distanceM(c[c.length - 1], c[0]);
  return m;
};

/* ── route code (dashboard → phone, as a QR code) ──────────────────────── */
export const ROUTE_TAG = 'PPROUTE1';
type CompactRoute = { i: string; n: string; a: string; d: number[]; s: string; e: string; r: number; l: 0 | 1; c: [number, number, string][] };
export interface RoutePack {
  guardId: string;
  guardName: string;
  at: number; // laptop clock when the code was made
  routes: PatrolRoute[];
}

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

export function encodeRoutePack(guardId: string, guardName: string, routes: PatrolRoute[]) {
  const r: CompactRoute[] = routes.map((x) => ({ i: x.id, n: x.name, a: x.areaId, d: x.days, s: x.start, e: x.end, r: x.radiusM, l: x.loop ? 1 : 0, c: x.checkpoints.map((c) => [round5(c.lat), round5(c.lng), c.label.slice(0, 40)]) }));
  return asciiJson({ t: ROUTE_TAG, g: guardId, gn: guardName, at: Date.now(), r });
}

export function parseRoutePack(text: string | null | undefined): RoutePack | null {
  if (!text || !text.includes(ROUTE_TAG)) return null;
  try {
    const p = JSON.parse(text) as { t: string; g: string; gn: string; at: number; r: CompactRoute[] };
    if (p.t !== ROUTE_TAG || !p.g || !Array.isArray(p.r)) return null;
    return {
      guardId: p.g,
      guardName: p.gn,
      at: p.at,
      routes: p.r.map((x) => ({
        id: x.i,
        name: x.n,
        guardId: p.g,
        areaId: x.a ?? '',
        days: x.d,
        start: x.s,
        end: x.e,
        radiusM: x.r,
        loop: Boolean(x.l),
        active: true,
        updatedAt: p.at,
        checkpoints: x.c.map(([lat, lng, label], k) => ({ id: `${x.i}-${k}`, lat, lng, label })),
      })),
    };
  } catch {
    return null;
  }
}

/* ── patrol report picture (phone → laptop, over the cable) ────────────── */
export const PATROL_TAG = 'PPPATROL1';
export interface PatrolPayload {
  t: typeof PATROL_TAG;
  rep: PatrolReport;
}
export function parsePatrolPayload(text: string | null | undefined): PatrolPayload | null {
  if (!text || !text.includes(PATROL_TAG)) return null;
  try {
    const p = JSON.parse(text) as PatrolPayload;
    return p?.t === PATROL_TAG && p.rep?.id && p.rep.routeId && Array.isArray(p.rep.visits) ? p : null;
  } catch {
    return null;
  }
}
