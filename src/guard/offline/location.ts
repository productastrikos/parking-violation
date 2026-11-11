/**
 * Where the guard is — really, or for a demo. (Pattern from MBKS
 * locationSource.ts.)
 *
 * THE DEMO PROBLEM. This POC is demonstrated from India for an Abu Dhabi
 * client. A real GPS fix would put every violation pin on the dashboard in
 * the wrong country. So there is a DEMO mode: the guard gets a plausible,
 * slowly moving position inside their own Abu Dhabi patrol area, and every
 * record and map marker made from it is labelled DEMO.
 *
 * THE FIELD PROBLEM. In the field only real GPS is acceptable, so the mode is
 * an explicit switch (Settings), remembered per device and shown wherever a
 * position is used.
 *
 * DEFAULT = DEMO, because this build is a demonstration. And a real fix that
 * lands outside the UAE is treated as "this phone is not in the field today":
 * the app switches itself to demo and says so. A guard genuinely in Abu Dhabi
 * keeps real GPS. Flip `readMode()` to default 'real' for a field rollout.
 *
 * The home point is deterministic per guard (hash of the user id around their
 * area's centre), so a guard does not teleport between app launches; a slow
 * random walk then makes successive records land on different streets of the
 * same district, as a patrol would.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { AREAS, CITY, type Gps } from '../../lib/api';

export type GpsMode = 'demo' | 'real';
const MODE_KEY = 'pp.gpsMode.v1';

/** The UAE, generously. A fix outside it means the phone is not on patrol here. */
const SERVICE_BOX = { minLat: 22.4, maxLat: 26.3, minLng: 51.4, maxLng: 56.6 };
export const inServiceArea = (p: { lat: number; lng: number }) =>
  p.lat >= SERVICE_BOX.minLat && p.lat <= SERVICE_BOX.maxLat && p.lng >= SERVICE_BOX.minLng && p.lng <= SERVICE_BOX.maxLng;

function readMode(): GpsMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'real' ? 'real' : 'demo';
  } catch {
    return 'demo';
  }
}

let mode: GpsMode = readMode();
let autoSwitched = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function setGpsMode(next: GpsMode) {
  mode = next;
  autoSwitched = false;
  try {
    localStorage.setItem(MODE_KEY, next);
  } catch {
    /* private mode — still switches for this session */
  }
  emit();
}
export const gpsMode = () => mode;
export const wasAutoSwitched = () => autoSwitched;
export function useGpsMode() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => mode,
  );
}

/* ── demo position ─────────────────────────────────────────────────────── */
function hash(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function homePoint(userId: string, areaId: string) {
  const a = AREAS.find((x) => x.id === areaId) ?? { lat: CITY.lat, lng: CITY.lng };
  const h = hash(userId);
  return {
    lat: +(a.lat + ((h % 1000) / 1000 - 0.5) * 0.008).toFixed(6),
    lng: +(a.lng + (((h >>> 11) % 1000) / 1000 - 0.5) * 0.008).toFixed(6),
  };
}

/** A patrol: drifts ~20–60 m per call, never more than ~700 m from home. */
let walker: { lat: number; lng: number; home: { lat: number; lng: number }; key: string } | null = null;
export function demoFix(userId: string, areaId: string): Gps & { demo: true } {
  const key = `${userId}|${areaId}`;
  const home = homePoint(userId, areaId);
  if (!walker || walker.key !== key) walker = { ...home, home, key };
  const step = 0.00025 + Math.random() * 0.0003;
  const ang = Math.random() * Math.PI * 2;
  let lat = walker.lat + Math.sin(ang) * step;
  let lng = walker.lng + Math.cos(ang) * step;
  // Pull back towards home when drifting too far.
  if (Math.hypot(lat - home.lat, lng - home.lng) > 0.0065) {
    lat = (lat + home.lat) / 2;
    lng = (lng + home.lng) / 2;
  }
  walker.lat = lat;
  walker.lng = lng;
  return { lat: +lat.toFixed(6), lng: +lng.toFixed(6), accuracy: 6 + Math.round(Math.random() * 9), demo: true };
}

/* ── the hook every screen uses ────────────────────────────────────────── */
export type GpsState =
  | { state: 'locating'; mode: GpsMode }
  | { state: 'fixed'; fix: Gps & { demo?: boolean }; mode: GpsMode }
  | { state: 'unavailable'; reason: string; mode: GpsMode };

/**
 * Demo: a fix at once (and a new step each time it is asked). Real: watch for
 * up to 25 s and keep the most accurate fix — GPS needs no internet, but a
 * first fix can take a while and never comes in a basement.
 */
export function useGps(userId: string, areaId: string): { gps: GpsState; retry: () => void } {
  const m = useGpsMode();
  const [attempt, setAttempt] = useState(0);
  const [gps, setGps] = useState<GpsState>(() => (m === 'demo' ? { state: 'fixed', fix: demoFix(userId, areaId), mode: 'demo' } : { state: 'locating', mode: 'real' }));

  useEffect(() => {
    if (m === 'demo') {
      setGps({ state: 'fixed', fix: demoFix(userId, areaId), mode: 'demo' });
      return;
    }
    if (!('geolocation' in navigator)) {
      setGps({ state: 'unavailable', reason: 'This browser has no location service', mode: 'real' });
      return;
    }
    setGps({ state: 'locating', mode: 'real' });
    let best: Gps | null = null;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const fix = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) };
        if (!inServiceArea(fix)) {
          // Not in the UAE → this phone is not on patrol: demo, and say so.
          navigator.geolocation.clearWatch(id);
          autoSwitched = true;
          mode = 'demo';
          emit();
          return;
        }
        if (!best || (fix.accuracy ?? 9e9) <= (best.accuracy ?? 9e9)) {
          best = fix;
          setGps({ state: 'fixed', fix, mode: 'real' });
        }
      },
      (err) => {
        if (best) return;
        setGps({
          state: 'unavailable',
          reason: err.code === err.PERMISSION_DENIED ? 'Location permission is off — allow it in the phone settings' : 'No GPS signal here — pick the area below',
          mode: 'real',
        });
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 60_000 },
    );
    const stop = setTimeout(() => navigator.geolocation.clearWatch(id), 25_000);
    return () => {
      clearTimeout(stop);
      navigator.geolocation.clearWatch(id);
    };
  }, [m, attempt, userId, areaId]);

  return { gps, retry: () => setAttempt((n) => n + 1) };
}

/** One position for the live map heartbeat (demo step, or the last real fix). */
let lastReal: (Gps & { at: number }) | null = null;
export function currentPosition(userId: string, areaId: string): Promise<(Gps & { demo: boolean }) | null> {
  if (mode === 'demo') return Promise.resolve(demoFix(userId, areaId));
  if (lastReal && Date.now() - lastReal.at < 60_000) return Promise.resolve({ ...lastReal, demo: false });
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const fix = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) };
        if (!inServiceArea(fix)) {
          autoSwitched = true;
          mode = 'demo';
          emit();
          return resolve(demoFix(userId, areaId));
        }
        lastReal = { ...fix, at: Date.now() };
        resolve({ ...fix, demo: false });
      },
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 120_000 },
    );
  });
}
