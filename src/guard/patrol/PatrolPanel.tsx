/**
 * Today's patrol — the top of the guard app's Patrol tab. Works with no network:
 *
 *   route      scanned from the dashboard's route code (or, online, sent with the
 *              field pack); several routes → chips to pick
 *   map        the built-in offline street map with the route and checkpoints
 *   progress   checkpoints tick off by GPS (within the route's radius) — or "I'm
 *              here" — and the report goes to the laptop with the tickets
 *   demo GPS   "walk the route" moves the guard along it, so it works on stage
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Flag, MapPin, Pause, Play, QrCode, RotateCcw, Route as RouteIcon, Usb, Navigation } from 'lucide-react';
import { useGpsMode, setGpsMode, inServiceArea } from '../offline/location';
import { deviceInfo, deviceLabel } from '../offline/device';
import { daysText, distanceM, routeLengthM, runsOn, type PatrolRoute, type RoutePack } from '../../lib/patrol';
import { finishPatrol, getRoutes, markVisit, reopenPatrol, reportFor, setRoutes, startPatrol, usePatrolVersion, type LocalReport, type StoredRoutes } from './patrolStore';
import type { Position } from './PatrolMap';
import type { User } from '../../lib/api';

const PatrolMap = lazy(() => import('./PatrolMap'));
const RouteScan = lazy(() => import('./RouteScan'));

/** Demo walking speed (m/s) — fast on purpose: any route is walked in about 90 seconds on stage. */
const demoSpeed = (r: PatrolRoute) => Math.max(20, routeLengthM(r) / 90);

/** Where the guard is: the phone's GPS while patrolling, or the demo walker. */
function usePatrolPosition(route: PatrolRoute | null, active: boolean, walking: boolean, targetIdx: number, onArrivedAll: () => void): Position | null {
  const mode = useGpsMode();
  const [pos, setPos] = useState<Position | null>(null);

  // Demo: start a little before the first checkpoint.
  useEffect(() => {
    if (mode !== 'demo' || !route) return;
    const c = route.checkpoints[0];
    setPos((p) => p ?? { lat: c.lat - 0.0011, lng: c.lng - 0.0009, accuracy: 8, demo: true });
  }, [mode, route]);

  // Demo walk: step towards the target checkpoint — by the time that really passed (timers are slowed in the background).
  useEffect(() => {
    if (mode !== 'demo' || !walking || !route) return;
    const speed = demoSpeed(route);
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      const dt = Math.min(3, (now - last) / 1000);
      last = now;
      setPos((p) => {
        if (!p) return p;
        const t = targetIdx >= 0 ? route.checkpoints[targetIdx] : route.loop ? route.checkpoints[0] : null;
        if (!t) {
          onArrivedAll();
          return p;
        }
        const d = distanceM(p, t);
        const step = speed * dt;
        if (d <= step) {
          if (targetIdx < 0) onArrivedAll();
          return { lat: t.lat, lng: t.lng, accuracy: 8, demo: true };
        }
        const k = step / d;
        return { lat: p.lat + (t.lat - p.lat) * k, lng: p.lng + (t.lng - p.lng) * k, accuracy: 8, demo: true };
      });
    }, 500);
    return () => clearInterval(id);
  }, [mode, walking, route, targetIdx, onArrivedAll]);

  // Real GPS: watch continuously while the patrol runs (GPS needs no internet).
  useEffect(() => {
    if (mode !== 'real' || !active || !('geolocation' in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const fix = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy), demo: false };
        if (!inServiceArea(fix)) {
          setGpsMode('demo'); // not in the UAE → this phone is not on patrol; demo GPS, labelled
          return;
        }
        setPos(fix);
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [mode, active]);

  return pos;
}

export function PatrolPanel({ user, onCable, onToast }: { user: User; onCable: () => void; onToast: (t: { text: string; tone: 'ok' | 'warn' }) => void }) {
  const v = usePatrolVersion();
  const mode = useGpsMode();
  const [stored, setStored] = useState<StoredRoutes | null | undefined>(undefined);
  const [sel, setSel] = useState<string | null>(null);
  const [rep, setRep] = useState<LocalReport | null>(null);
  const [scanning, setScanning] = useState(false);
  const [walking, setWalking] = useState(false);

  useEffect(() => {
    void getRoutes(user.id).then((s) => setStored(s ?? null));
  }, [user.id, v]);
  const routes = useMemo(() => (stored?.routes ?? []).filter((r) => r.active), [stored]);
  const route = routes.find((r) => r.id === sel) ?? routes.find((r) => runsOn(r)) ?? routes[0] ?? null;

  useEffect(() => {
    if (!route) return setRep(null);
    void reportFor(route.id, user.id).then(setRep);
  }, [route, user.id, v]);

  const reached = useMemo(() => new Set(rep?.visits.map((x) => x.cp) ?? []), [rep]);
  const nextIdx = route ? route.checkpoints.findIndex((_, i) => !reached.has(i)) : -1;
  const active = Boolean(rep && !rep.finishedAt);
  const stopWalking = useCallback(() => setWalking(false), []);
  const pos = usePatrolPosition(route, active, walking, nextIdx, stopWalking);
  const marking = useRef(new Set<string>());

  // Tick checkpoints off as the guard reaches them (each once — positions arrive faster than the store updates).
  useEffect(() => {
    if (!route || !rep || rep.finishedAt || !pos) return;
    route.checkpoints.forEach((c, i) => {
      const key = `${rep.id}:${i}`;
      if (!reached.has(i) && !marking.current.has(key) && distanceM(pos, c) <= route.radiusM + Math.min(25, pos.accuracy ?? 0)) {
        marking.current.add(key);
        void markVisit(rep.id, i, pos.demo ? 'demo' : 'gps').then(() => {
          navigator.vibrate?.(50);
          onToast({ text: `Checkpoint ${i + 1} reached — ${c.label || 'checkpoint'}`, tone: 'ok' });
        });
      }
    });
  }, [pos, route, rep, reached, onToast]);

  async function start() {
    if (!route) return;
    const d = await deviceInfo();
    setRep(await startPatrol(route, user, { deviceId: d.deviceId, label: await deviceLabel() }));
    onToast({ text: `Patrol started — ${route.name}`, tone: 'ok' });
  }

  async function loaded(pack: RoutePack) {
    setScanning(false);
    if (pack.guardId !== user.id) {
      onToast({ text: `That code is for ${pack.guardName} (${pack.guardId}) — you are signed in as ${user.name}`, tone: 'warn' });
      return;
    }
    await setRoutes(user.id, pack.routes, 'code');
    setSel(null);
    const skew = Math.round((Date.now() - pack.at) / 60_000);
    onToast({
      text: `${pack.routes.length} route${pack.routes.length === 1 ? '' : 's'} loaded${Math.abs(skew) >= 5 ? ` · this phone's clock is ${Math.abs(skew)} min ${skew > 0 ? 'ahead of' : 'behind'} the laptop` : ''}`,
      tone: Math.abs(skew) >= 5 ? 'warn' : 'ok',
    });
  }

  const next = route && nextIdx >= 0 ? route.checkpoints[nextIdx] : null;
  const dist = next && pos ? Math.round(distanceM(pos, next)) : null;

  return (
    <section className="n-card g-patrol">
      <div className="g-ai-head">
        <span className="g-ai-brand">
          <RouteIcon size={14} /> Today's patrol
        </span>
        <button className="btn btn-ghost btn-sm" onClick={() => setScanning(true)}>
          <QrCode size={14} /> Scan route code
        </button>
      </div>

      {stored !== undefined && !route && (
        <div className="g-patrol-empty">
          <MapPin size={26} />
          <div>
            <b>No patrol route on this phone yet.</b>
            <div className="faint" style={{ fontSize: 13 }}>
              Ask the control room to open Field Team → Patrol routes → <b>Code for phone</b>, then scan it here. No network needed.
            </div>
          </div>
          <button className="btn btn-primary n-primary" onClick={() => setScanning(true)}>
            <QrCode size={16} /> Scan route code
          </button>
        </div>
      )}

      {route && (
        <>
          {routes.length > 1 && (
            <div className="g-route-chips">
              {routes.map((r) => (
                <button key={r.id} className={`g-route-chip${r.id === route.id ? ' is-on' : ''}`} onClick={() => setSel(r.id)}>
                  {r.name}
                  {!runsOn(r) && <span className="faint"> · not today</span>}
                </button>
              ))}
            </div>
          )}
          <div className="g-patrol-title">
            <b>{route.name}</b>
            <span className="faint">
              {daysText(route.days)} · {route.start}–{route.end}
              {!runsOn(route) && ' · not scheduled today'}
            </span>
          </div>
          <div className="g-patrol-progress" aria-label={`${reached.size} of ${route.checkpoints.length} checkpoints`}>
            <div style={{ width: `${(reached.size / route.checkpoints.length) * 100}%` }} />
          </div>
          <div className="g-patrol-stats">
            <span>
              <b>{reached.size}</b> of {route.checkpoints.length} checkpoints
            </span>
            {rep && <span className="faint">{rep.finishedAt ? `finished ${new Date(rep.finishedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : `started ${new Date(rep.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}</span>}
            {mode === 'demo' && <span className="g-demo-tag">DEMO GPS</span>}
          </div>

          <Suspense fallback={<div className="g-patrol-map" style={{ height: 300 }} />}>
            <PatrolMap route={route} reached={reached} nextIdx={nextIdx} position={pos} />
          </Suspense>

          {active && next && (
            <div className="g-next-cp">
              <Navigation size={16} />
              <span>
                Next: <b>{nextIdx + 1}. {next.label || 'Checkpoint'}</b>
                {dist !== null ? ` · ${dist >= 1000 ? `${(dist / 1000).toFixed(1)} km` : `${dist} m`}` : ''}
              </span>
            </div>
          )}
          {active && !next && (
            <div className="g-note g-note-ok">
              <CheckCircle2 size={15} /> All checkpoints reached — finish the patrol.
            </div>
          )}

          <div className="g-patrol-actions">
            {!rep && (
              <button className="btn btn-primary btn-lg btn-block n-primary" onClick={() => void start()}>
                <Play size={18} /> Start patrol
              </button>
            )}
            {active && (
              <>
                {next && (
                  <button className="btn btn-lg" onClick={() => void markVisit(rep!.id, nextIdx, 'manual').then(() => onToast({ text: `Checkpoint ${nextIdx + 1} marked`, tone: 'ok' }))}>
                    <Flag size={16} /> I'm at {nextIdx + 1}
                  </button>
                )}
                {mode === 'demo' && (
                  <button className="btn btn-lg" onClick={() => setWalking((w) => !w)}>
                    {walking ? <Pause size={16} /> : <Play size={16} />} {walking ? 'Stop walking' : 'Demo: walk the route'}
                  </button>
                )}
                <button
                  className="btn btn-lg btn-primary n-primary"
                  onClick={() =>
                    void finishPatrol(rep!.id).then(() => {
                      setWalking(false);
                      onToast({ text: 'Patrol finished — send it to the laptop with the tickets', tone: 'ok' });
                    })
                  }
                >
                  <CheckCircle2 size={16} /> Finish patrol
                </button>
              </>
            )}
            {rep?.finishedAt && (
              <>
                <button className="btn btn-lg btn-primary n-primary" onClick={onCable}>
                  <Usb size={16} /> Send to laptop by cable
                </button>
                <button className="btn btn-lg" onClick={() => void reopenPatrol(rep.id)}>
                  <RotateCcw size={16} /> Continue patrol
                </button>
              </>
            )}
          </div>
          <p className="faint" style={{ fontSize: 12, margin: '8px 0 0' }}>
            Checkpoints tick off when you are within {route.radiusM} m — GPS works without internet. The patrol report goes to the laptop with your tickets.
          </p>
        </>
      )}

      {scanning && (
        <Suspense fallback={null}>
          <RouteScan onResult={(p) => void loaded(p)} onClose={() => setScanning(false)} />
        </Suspense>
      )}
    </section>
  );
}
