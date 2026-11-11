/**
 * Deterministic demo data: accounts and a week of SAMPLE violations, so the
 * dashboard is not empty when the demo opens. Every seeded record is marked
 * `seeded: true` and the dashboard labels it "Sample", so nobody mistakes it
 * for a record captured on a phone. Plates are synthetic.
 *
 * Seeded PRNG (mulberry32): the same data on every reset, so screenshots and
 * KPI numbers are reproducible.
 */
import crypto from 'node:crypto';
import { VIOLATION_TYPES, AREAS, EMIRATES } from '../../shared/catalog.js';

export const SEED_PASSWORD = process.env.APP_PASSWORD || 'Astrikos2026';

/** id = the login name. Guards use the field app; supervisor/admin use the dashboard (supervisor can use both). */
export const SEED_USERS = [
  { id: 'admin', name: 'Control Room Admin', role: 'admin', area: '', phone: '' },
  { id: 'supervisor', name: 'Khalid Al Mansoori', role: 'supervisor', area: 'markaziyah', phone: '+971 50 000 0101' },
  { id: 'guard1', name: 'Rashid Ahmed', role: 'guard', area: 'markaziyah', phone: '+971 50 000 0111' },
  { id: 'guard2', name: 'Imran Shaikh', role: 'guard', area: 'reem', phone: '+971 50 000 0112' },
  { id: 'guard3', name: 'Joseph Mathew', role: 'guard', area: 'khalidiyah', phone: '+971 50 000 0113' },
  { id: 'guard4', name: 'Bilal Hussain', role: 'guard', area: 'yas', phone: '+971 50 000 0114' },
];

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const AD_CODES = ['1', '4', '5', '6', '7', '8', '10', '11', '12', '13', '14', '15', '16', '17', '50'];
const DXB_CODES = ['A', 'B', 'D', 'F', 'G', 'H', 'K', 'L', 'M', 'N', 'P', 'R', 'T', 'X'];
const NOTES = [
  'Hazard lights on, driver not present.',
  'Vehicle left for over 20 minutes.',
  'Blocking the exit lane of the building.',
  'Repeated offence at this spot this week.',
  'Delivery van, engine off.',
  '',
  '',
  '',
];

export function buildSeedViolations(now = Date.now(), count = 46) {
  const rnd = mulberry32(20261112);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const guards = SEED_USERS.filter((u) => u.role === 'guard');
  const weights = { 'no-parking': 9, 'double-parking': 6, 'disabled-bay': 4, 'fire-lane': 3, blocking: 5, footpath: 4, 'bus-stop': 3, unpaid: 7, 'outside-bay': 4, 'loading-zone': 2, 'wrong-way': 1, abandoned: 2, other: 1 };
  const bag = VIOLATION_TYPES.flatMap((t) => Array(weights[t.id] ?? 1).fill(t));
  const out = [];
  for (let i = 0; i < count; i++) {
    const g = pick(guards);
    // Guards patrol their own area most of the time.
    const area = rnd() < 0.7 ? AREAS.find((a) => a.id === g.area) : pick(AREAS);
    const type = pick(bag);
    const emirate = rnd() < 0.72 ? 'AD' : rnd() < 0.7 ? 'DXB' : pick(EMIRATES).id;
    const code = emirate === 'AD' ? pick(AD_CODES) : emirate === 'DXB' ? pick(DXB_CODES) : String(1 + Math.floor(rnd() * 3));
    const number = String(10 + Math.floor(rnd() * 89990));
    const daysAgo = Math.floor(Math.pow(rnd(), 1.4) * 7);
    const hour = 7 + Math.floor(rnd() * 14);
    const d = new Date(now - daysAgo * 86_400_000);
    d.setHours(hour, Math.floor(rnd() * 60), Math.floor(rnd() * 60), 0);
    const capturedAt = Math.min(d.getTime(), now - 30 * 60_000);
    const offline = rnd() < 0.3;
    const receivedAt = capturedAt + (offline ? (5 + Math.floor(rnd() * 90)) * 60_000 : 1500 + Math.floor(rnd() * 3000));
    const ageH = (now - capturedAt) / 3_600_000;
    const status = ageH < 6 ? 'new' : rnd() < 0.55 ? 'actioned' : rnd() < 0.7 ? 'reviewed' : 'dismissed';
    const seq = String(i + 1).padStart(4, '0');
    out.push({
      id: crypto.randomUUID(),
      ref: `PV-${g.id.toUpperCase()}-S${seq}`,
      type: type.id,
      severity: type.severity,
      plate: { emirate, code, number, raw: `${code} ${number}`, source: rnd() < 0.6 ? 'ocr' : 'manual' },
      location: {
        areaId: area.id,
        landmark: '',
        gps: { lat: area.lat + (rnd() - 0.5) * 0.012, lng: area.lng + (rnd() - 0.5) * 0.014, accuracy: Math.round(6 + rnd() * 25) },
      },
      notes: type.id === 'other' ? 'Vehicle parked inside a construction barrier.' : pick(NOTES),
      photos: [],
      guardId: g.id,
      guardName: g.name,
      deviceId: `seed-${g.id}`,
      deviceLabel: 'Sample device',
      capturedAt,
      capturedOffline: offline,
      receivedAt,
      clockSkewMs: 0,
      status,
      history: [{ at: receivedAt, by: g.name, action: offline ? 'Captured offline, synced later' : 'Captured and synced' }],
      seeded: true,
    });
  }
  return out.sort((a, b) => b.capturedAt - a.capturedAt);
}
