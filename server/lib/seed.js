/**
 * Deterministic demo data: accounts and two weeks of SAMPLE violations, so the
 * dashboard, the forecasts and the AI advisory have something to work with
 * when the demo opens. Every seeded record is marked `seeded: true` and the
 * dashboard labels it "Sample". Plates and names are synthetic.
 *
 * The sample is shaped like a city, not like noise, because the advisory
 * engine reads patterns out of it:
 *   • each area has its own busy hours (Downtown at lunch and evening, Yas in
 *     the evening, Mussafah in the morning);
 *   • a handful of plates are repeat offenders;
 *   • one pair of records is a near-duplicate (same plate, area, type, 9 min
 *     apart) so the duplicate check has something real to find.
 *
 * Seeded PRNG (mulberry32): the same data on every reset.
 */
import crypto from 'node:crypto';
import { VIOLATION_TYPES, AREAS } from '../../shared/catalog.js';

export const SEED_PASSWORD = process.env.APP_PASSWORD || 'Astrikos2026';

/** id = the login name. Guards use the field app; supervisor/admin use the dashboard. */
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

/** Busy hours per area (weights for 7:00–22:00), so hotspots and forecasts have a shape. */
const AREA_PROFILE = {
  markaziyah: { weight: 9, peaks: [12, 13, 18, 19] },
  khalidiyah: { weight: 6, peaks: [9, 17, 18] },
  zahiyah: { weight: 5, peaks: [20, 21] },
  reem: { weight: 6, peaks: [8, 9, 18] },
  maryah: { weight: 4, peaks: [8, 13] },
  corniche: { weight: 4, peaks: [17, 19, 20] },
  yas: { weight: 5, peaks: [19, 20, 21] },
  mussafah: { weight: 4, peaks: [7, 8, 10] },
  'khalifa-city': { weight: 2, peaks: [16, 17] },
  saadiyat: { weight: 2, peaks: [11, 16] },
  bateen: { weight: 2, peaks: [10, 19] },
  nahyan: { weight: 1, peaks: [12] },
  mushrif: { weight: 1, peaks: [17] },
  raha: { weight: 1, peaks: [18] },
  'mbz-city': { weight: 1, peaks: [8] },
};

const AD_CODES = ['1', '4', '5', '6', '7', '8', '10', '11', '12', '13', '14', '15', '16', '17', '50'];
const DXB_CODES = ['A', 'B', 'D', 'F', 'G', 'H', 'K', 'L', 'M', 'N', 'P', 'R', 'T', 'X'];
const NOTES = [
  'Hazard lights on, driver not present.',
  'Vehicle left for over 20 minutes.',
  'Blocking the exit lane of the building.',
  'Delivery van, engine off.',
  'Driver returned and left before a fine could be issued.',
  '',
  '',
  '',
  '',
];
const LANDMARKS = {
  markaziyah: ['Hamdan St, near the mall entrance', 'Electra St, bus stop 3', 'Schneider Building, Basement P1'],
  khalidiyah: ['Khalidiyah Mall drop-off', 'Al Khalidiyah Park gate 2'],
  reem: ['Boutik Mall service road', 'Shams Gate District, tower 3'],
  yas: ['Yas Mall, Gate 4 drop-off', 'Ferrari World coach bays'],
  corniche: ['Corniche beach parking, lot B'],
  zahiyah: ['Tourist Club Area, 10th St'],
  mussafah: ['Mussafah M-10 workshops lane'],
};

/** Repeat offenders: these plates come back again and again. */
const OFFENDERS = [
  { emirate: 'AD', code: '5', number: '72814', times: 5 },
  { emirate: 'DXB', code: 'K', number: '30917', times: 4 },
  { emirate: 'AD', code: '16', number: '4471', times: 3 },
  { emirate: 'AD', code: '12', number: '58820', times: 3 },
  { emirate: 'SHJ', code: '2', number: '19046', times: 2 },
];

export function buildSeedViolations(now = Date.now(), days = 14) {
  const rnd = mulberry32(20261112);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const guards = SEED_USERS.filter((u) => u.role === 'guard');
  const weights = { 'no-parking': 9, 'double-parking': 6, 'disabled-bay': 4, 'fire-lane': 3, blocking: 5, footpath: 4, 'bus-stop': 3, unpaid: 7, 'outside-bay': 4, 'loading-zone': 2, 'wrong-way': 1, abandoned: 2, other: 1 };
  const typeBag = VIOLATION_TYPES.flatMap((t) => Array(weights[t.id] ?? 1).fill(t));
  const areaBag = AREAS.flatMap((a) => Array(AREA_PROFILE[a.id]?.weight ?? 1).fill(a));

  const hourFor = (areaId) => {
    const peaks = AREA_PROFILE[areaId]?.peaks ?? [12];
    return rnd() < 0.62 ? pick(peaks) : 7 + Math.floor(rnd() * 15);
  };

  const plateFor = () => {
    const emirate = rnd() < 0.72 ? 'AD' : rnd() < 0.7 ? 'DXB' : pick(['SHJ', 'AJM', 'RAK', 'FUJ', 'UAQ']);
    const code = emirate === 'AD' ? pick(AD_CODES) : emirate === 'DXB' ? pick(DXB_CODES) : String(1 + Math.floor(rnd() * 3));
    return { emirate, code, number: String(10 + Math.floor(rnd() * 89990)) };
  };

  const make = (i, { plate, area, dayOffset, hour, minute, type, guard }) => {
    const g = guard ?? (rnd() < 0.7 ? guards.find((x) => x.area === area.id) ?? pick(guards) : pick(guards));
    const t = type ?? pick(typeBag);
    const d = new Date(now - dayOffset * 86_400_000);
    d.setHours(hour, minute ?? Math.floor(rnd() * 60), Math.floor(rnd() * 60), 0);
    const capturedAt = Math.min(d.getTime(), now - 25 * 60_000);
    const offline = rnd() < 0.28;
    const receivedAt = capturedAt + (offline ? (4 + Math.floor(rnd() * 80)) * 60_000 : 1200 + Math.floor(rnd() * 3000));
    const ageH = (now - capturedAt) / 3_600_000;
    const status = ageH < 5 ? 'new' : rnd() < 0.55 ? 'actioned' : rnd() < 0.7 ? 'reviewed' : 'dismissed';
    const lm = LANDMARKS[area.id];
    return {
      id: crypto.randomUUID(),
      ref: `PV-S${String(i + 1).padStart(4, '0')}`,
      type: t.id,
      severity: t.severity,
      plate: { ...plate, raw: `${plate.code} ${plate.number}`, source: rnd() < 0.6 ? 'ocr' : 'manual' },
      location: {
        areaId: area.id,
        landmark: lm && rnd() < 0.6 ? pick(lm) : '',
        gps: { lat: +(area.lat + (rnd() - 0.5) * 0.012).toFixed(6), lng: +(area.lng + (rnd() - 0.5) * 0.014).toFixed(6), accuracy: Math.round(6 + rnd() * 25), demo: false },
      },
      notes: t.id === 'other' ? 'Vehicle parked inside a construction barrier.' : pick(NOTES),
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
      edits: [],
      seeded: true,
    };
  };

  const out = [];
  let i = 0;
  // Daily volume grows slightly towards today, so the trend factor has something to say.
  for (let day = days - 1; day >= 0; day--) {
    const perDay = 7 + Math.round((days - day) * 0.35 + rnd() * 4);
    for (let k = 0; k < perDay; k++) {
      const area = pick(areaBag);
      const hour = hourFor(area.id);
      if (day === 0 && hour >= new Date(now).getHours()) continue; // nothing from the future
      out.push(make(i++, { plate: plateFor(), area, dayOffset: day, hour }));
    }
  }
  // Repeat offenders, spread over the fortnight, mostly in one area each.
  for (const o of OFFENDERS) {
    const home = pick(areaBag);
    for (let n = 0; n < o.times; n++) {
      const area = rnd() < 0.75 ? home : pick(areaBag);
      const dayOffset = Math.floor(rnd() * days);
      const hour = hourFor(area.id);
      if (dayOffset === 0 && hour >= new Date(now).getHours()) continue;
      out.push(make(i++, { plate: { emirate: o.emirate, code: o.code, number: o.number }, area, dayOffset, hour }));
    }
  }
  // One near-duplicate pair from yesterday (two guards, same car, 9 minutes apart).
  const dupArea = AREAS.find((a) => a.id === 'markaziyah');
  const dupPlate = { emirate: 'AD', code: '7', number: '61203' };
  const dupType = VIOLATION_TYPES.find((t) => t.id === 'double-parking');
  out.push(make(i++, { plate: dupPlate, area: dupArea, dayOffset: 1, hour: 13, minute: 10, type: dupType, guard: SEED_USERS.find((u) => u.id === 'guard1') }));
  out.push(make(i++, { plate: dupPlate, area: dupArea, dayOffset: 1, hour: 13, minute: 19, type: dupType, guard: SEED_USERS.find((u) => u.id === 'supervisor') }));

  return out.sort((a, b) => b.capturedAt - a.capturedAt);
}
