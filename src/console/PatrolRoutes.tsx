/**
 * Patrol routes — on the Field Team page.
 *
 *   Routes table    each route: guard, days and shift, checkpoints, and TODAY's
 *                   status from the patrol reports the phones handed in.
 *   Route editor    click the (offline) map to add checkpoints in order, drag to
 *                   move, name them; days, shift hours, how close counts.
 *   Code for phone  the guard's routes as a QR code. On the phone: Patrol → Scan
 *                   route code. No network needed — iPhone and Android alike.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import QRCode from 'qrcode';
import { ArrowDown, ArrowUp, CheckCircle2, Clock, Loader2, MapPinned, Pencil, Plus, QrCode, Route as RouteIcon, Trash2, AlertTriangle, Usb } from 'lucide-react';
import { AREAS, CITY, ago, areaOf, fmtTime, type TeamRow } from '../lib/api';
import { mountBaseMap } from '../lib/basemap';
import { useTheme } from '../lib/ui';
import { DAY_SHORT, ROUTE_COLORS, dayKey, daysText, encodeRoutePack, routeLengthM, runsOn, type Checkpoint, type PatrolReport, type PatrolRoute } from '../lib/patrol';
import type { Live } from './useLive';
import { Modal, useToast } from './parts';

export const colorOf = (routes: PatrolRoute[], id: string) => ROUTE_COLORS[Math.max(0, routes.findIndex((r) => r.id === id)) % ROUTE_COLORS.length];

/** Today's report for a route (the latest, if a guard sent more than one). */
const todayOf = (patrols: PatrolReport[], routeId: string) => patrols.find((p) => p.routeId === routeId && p.date === dayKey());

function TodayStatus({ r, rep }: { r: PatrolRoute; rep?: PatrolReport }) {
  if (!runsOn(r)) return <span className="faint">Not today</span>;
  if (!rep) return <span className="chip">Not reported yet</span>;
  const reached = new Set(rep.visits.map((v) => v.cp)).size;
  const all = reached >= rep.total && rep.total > 0;
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <span className={`chip ${all ? 'chip-success' : rep.finishedAt ? 'chip-warning' : 'chip-info'}`}>
        {all ? <CheckCircle2 size={12} /> : <Clock size={12} />} {reached}/{rep.total} checkpoints
      </span>
      <span className="faint" style={{ fontSize: 12 }}>
        {rep.finishedAt ? `finished ${fmtTime(rep.finishedAt)}` : `started ${fmtTime(rep.startedAt)}`}
        {rep.via === 'cable' ? ' · by cable' : ''}
      </span>
    </span>
  );
}

export function PatrolRoutesCard({ live }: { live: Live }) {
  const guards = useMemo(() => live.team.filter((t) => t.role === 'guard'), [live.team]);
  const [editing, setEditing] = useState<Partial<PatrolRoute> | null>(null);
  const [codeFor, setCodeFor] = useState<TeamRow | null>(null);
  const toast = useToast();
  const sorted = useMemo(() => [...live.routes].sort((a, b) => a.guardId.localeCompare(b.guardId) || a.name.localeCompare(b.name)), [live.routes]);
  const nameOf = (id: string) => guards.find((g) => g.id === id)?.name ?? id;

  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="card-head">
        <div>
          <h3>Patrol routes</h3>
          <div className="faint" style={{ fontSize: 12 }}>
            Set each guard's daily route here. Phones get it by scanning the route code (no network); reports come back with the tickets over the USB cable.
          </div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing({ days: [0, 1, 2, 3, 4, 5, 6], start: '07:00', end: '15:00', radiusM: 40, loop: true, checkpoints: [] })}>
          <Plus size={15} /> New route
        </button>
      </div>
      <div className="c-table-wrap">
        <table className="c-table">
          <thead>
            <tr>
              <th>Route</th>
              <th>Guard</th>
              <th>Days · shift</th>
              <th className="num">Checkpoints</th>
              <th>Today</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={6} className="c-empty">
                  No routes yet — New route, then click the map to add checkpoints.
                </td>
              </tr>
            )}
            {sorted.map((r) => (
              <tr key={r.id}>
                <td>
                  <span className="c-route-swatch" style={{ background: colorOf(live.routes, r.id) }} />
                  <b>{r.name}</b>
                  <div className="faint" style={{ fontSize: 12 }}>
                    {areaOf(r.areaId)?.label ?? 'Any area'} · {(routeLengthM(r) / 1000).toFixed(1)} km{r.loop ? ' loop' : ''}
                  </div>
                </td>
                <td>{nameOf(r.guardId)}</td>
                <td>
                  {daysText(r.days)}
                  <div className="faint" style={{ fontSize: 12 }}>
                    {r.start}–{r.end}
                  </div>
                </td>
                <td className="num">{r.checkpoints.length}</td>
                <td>
                  <TodayStatus r={r} rep={todayOf(live.patrols, r.id)} />
                </td>
                <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                  <button className="btn btn-sm" onClick={() => setCodeFor(guards.find((g) => g.id === r.guardId) ?? null)} title="Show the route code for this guard's phone">
                    <QrCode size={14} /> Code for phone
                  </button>{' '}
                  <button className="icon-btn" onClick={() => setEditing(r)} aria-label={`Edit ${r.name}`}>
                    <Pencil size={16} />
                  </button>
                  <button
                    className="icon-btn"
                    onClick={async () => {
                      if (!window.confirm(`Delete the route "${r.name}"? Phones keep their copy until they scan a new code.`)) return;
                      try {
                        await live.deleteRoute(r.id);
                        toast(`Route ${r.name} deleted`);
                      } catch (e) {
                        toast((e as Error).message, 'error');
                      }
                    }}
                    aria-label={`Delete ${r.name}`}
                  >
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <RecentReports live={live} nameOf={nameOf} />
      {editing && (
        <RouteEditor
          initial={editing}
          guards={guards}
          others={live.routes.filter((r) => r.id !== editing.id)}
          onClose={() => setEditing(null)}
          onSave={async (r) => {
            const saved = await live.saveRoute(r);
            setEditing(null);
            toast(`Route ${saved.name} saved — show the code to ${nameOf(saved.guardId)}'s phone`);
          }}
        />
      )}
      {codeFor && <RouteCodeModal guard={codeFor} routes={live.routes.filter((r) => r.guardId === codeFor.id && r.active)} onClose={() => setCodeFor(null)} />}
    </section>
  );
}

/** The last reports, so a supervisor sees what came back over the cable. */
function RecentReports({ live, nameOf }: { live: Live; nameOf: (id: string) => string }) {
  const recent = live.patrols.slice(0, 6);
  if (!recent.length) return null;
  return (
    <div className="c-patrol-reports">
      <div className="faint" style={{ fontSize: 12, margin: '10px 0 6px' }}>
        Latest patrol reports
      </div>
      {recent.map((p) => {
        const reached = new Set(p.visits.map((v) => v.cp)).size;
        return (
          <div key={p.id} className="c-patrol-report">
            <RouteIcon size={15} className="faint" />
            <b>{p.routeName}</b>
            <span>{nameOf(p.guardId)}</span>
            <span className={`chip ${reached >= p.total ? 'chip-success' : 'chip-warning'}`}>
              {reached}/{p.total}
            </span>
            <span className="faint">
              {p.date} · {fmtTime(p.startedAt)}–{p.finishedAt ? fmtTime(p.finishedAt) : 'in progress'}
            </span>
            {p.via === 'cable' && (
              <span className="faint">
                <Usb size={12} /> cable · {ago(p.receivedAt)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── the route editor ─────────────────────────────────────────────────── */
function RouteEditor({ initial, guards, others, onClose, onSave }: { initial: Partial<PatrolRoute>; guards: TeamRow[]; others: PatrolRoute[]; onClose: () => void; onSave: (r: Partial<PatrolRoute>) => Promise<void> }) {
  const [name, setName] = useState(initial.name ?? '');
  const [guardId, setGuardId] = useState(initial.guardId ?? guards[0]?.id ?? '');
  const [areaId, setAreaId] = useState(initial.areaId ?? guards.find((g) => g.id === (initial.guardId ?? guards[0]?.id))?.area ?? '');
  const [days, setDays] = useState<number[]>(initial.days ?? [0, 1, 2, 3, 4, 5, 6]);
  const [start, setStart] = useState(initial.start ?? '07:00');
  const [end, setEnd] = useState(initial.end ?? '15:00');
  const [radiusM, setRadius] = useState(initial.radiusM ?? 40);
  const [loop, setLoop] = useState(initial.loop ?? true);
  const [cps, setCps] = useState<Checkpoint[]>(initial.checkpoints ?? []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const draw = useRef<L.LayerGroup | null>(null);
  const theme = useTheme();
  const cpsRef = useRef(cps);
  cpsRef.current = cps;

  // The map: offline base, other routes faint for context, click to add a checkpoint.
  useEffect(() => {
    if (!el.current) return;
    const area = areaOf(areaId);
    const first = cps[0];
    const m = L.map(el.current, { zoomControl: true, maxZoom: 18 }).setView(first ? [first.lat, first.lng] : area ? [area.lat, area.lng] : [CITY.lat, CITY.lng], first || area ? 15 : 12);
    map.current = m;
    let base: { remove: () => void } | null = null;
    void mountBaseMap(m, theme).then((b) => (map.current === m ? (base = b) : b.remove()));
    const ctx = L.layerGroup().addTo(m);
    for (const r of others) L.polyline(r.checkpoints.map((c) => [c.lat, c.lng] as L.LatLngTuple), { color: '#94a3b8', weight: 2, opacity: 0.6, dashArray: '3 6', interactive: false }).addTo(ctx);
    draw.current = L.layerGroup().addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => {
      if (cpsRef.current.length >= 20) return setErr('At most 20 checkpoints per route');
      setCps((list) => [...list, { id: `cp-${Date.now().toString(36)}`, lat: Math.round(e.latlng.lat * 1e5) / 1e5, lng: Math.round(e.latlng.lng * 1e5) / 1e5, label: `Checkpoint ${list.length + 1}` }]);
    });
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      base?.remove();
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A new route follows the chosen area (once there are checkpoints, the map stays put).
  useEffect(() => {
    const a = areaOf(areaId);
    if (a && !cpsRef.current.length) map.current?.setView([a.lat, a.lng], 15);
  }, [areaId]);

  // Redraw the route as it is edited; markers drag to move a checkpoint.
  useEffect(() => {
    const g = draw.current;
    if (!g) return;
    g.clearLayers();
    const pts = cps.map((c) => [c.lat, c.lng] as L.LatLngTuple);
    if (pts.length > 1) L.polyline(loop && pts.length > 2 ? [...pts, pts[0]] : pts, { color: '#7c3aed', weight: 4, opacity: 0.85 }).addTo(g);
    cps.forEach((c, i) => {
      L.circle([c.lat, c.lng], { radius: radiusM, color: '#7c3aed', weight: 1, fillOpacity: 0.08, interactive: false }).addTo(g);
      const mk = L.marker([c.lat, c.lng], { draggable: true, icon: L.divIcon({ className: '', html: `<div class="c-cp-pin" style="--cp:#7c3aed"><span>${i + 1}</span></div>`, iconSize: [24, 24], iconAnchor: [12, 12] }) })
        .bindTooltip(c.label || `Checkpoint ${i + 1}`)
        .addTo(g);
      mk.on('dragend', () => {
        const p = mk.getLatLng();
        setCps((list) => list.map((x) => (x.id === c.id ? { ...x, lat: Math.round(p.lat * 1e5) / 1e5, lng: Math.round(p.lng * 1e5) / 1e5 } : x)));
      });
    });
  }, [cps, loop, radiusM]);

  const move = (i: number, d: -1 | 1) =>
    setCps((list) => {
      const j = i + d;
      if (j < 0 || j >= list.length) return list;
      const n = [...list];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  async function save() {
    setErr(null);
    if (!name.trim()) return setErr('Give the route a name');
    if (cps.length < 2) return setErr('Click the map to add at least 2 checkpoints');
    if (!days.length) return setErr('Choose at least one day');
    setBusy(true);
    try {
      await onSave({ id: initial.id, name: name.trim(), guardId, areaId, days, start, end, radiusM, loop, checkpoints: cps, active: true });
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title={initial.id ? `Edit route — ${initial.name}` : 'New patrol route'} onClose={onClose} wide>
      <div className="c-route-editor">
        <div>
          <div ref={el} className="c-route-map" />
          <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>
            <MapPinned size={12} /> Click the map to add the next checkpoint · drag a number to move it · the circle shows how close counts as reached
          </div>
        </div>
        <div className="c-route-form">
          <label className="field">
            <span>Route name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Corniche morning loop" />
          </label>
          <div className="c-route-two">
            <label className="field">
              <span>Guard</span>
              <select
                className="select"
                value={guardId}
                onChange={(e) => {
                  setGuardId(e.target.value);
                  // A new route starts in that guard's patrol area.
                  const area = guards.find((g) => g.id === e.target.value)?.area;
                  if (area && !cps.length) setAreaId(area);
                }}
              >
                {guards.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({g.id})
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Area</span>
              <select className="select" value={areaId} onChange={(e) => setAreaId(e.target.value)}>
                <option value="">Any</option>
                {AREAS.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="field">
            <span>Days</span>
            <div className="c-days">
              {DAY_SHORT.map((d, i) => (
                <button key={d} type="button" className={`c-day${days.includes(i) ? ' is-on' : ''}`} onClick={() => setDays((x) => (x.includes(i) ? x.filter((y) => y !== i) : [...x, i].sort()))}>
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div className="c-route-two">
            <label className="field">
              <span>Shift starts</span>
              <input className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label className="field">
              <span>Shift ends</span>
              <input className="input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </label>
          </div>
          <div className="c-route-two">
            <label className="field">
              <span>Reached within (m)</span>
              <input className="input" type="number" min={10} max={200} value={radiusM} onChange={(e) => setRadius(Math.max(10, Math.min(200, Number(e.target.value) || 40)))} />
            </label>
            <label className="field c-check">
              <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> Back to the start (loop)
            </label>
          </div>
          <div className="field">
            <span>
              Checkpoints ({cps.length}/20) · {(routeLengthM({ checkpoints: cps, loop }) / 1000).toFixed(2)} km
            </span>
            <div className="c-cp-list">
              {cps.length === 0 && <div className="faint">Click the map to add the first checkpoint.</div>}
              {cps.map((c, i) => (
                <div key={c.id} className="c-cp-row">
                  <span className="c-cp-n">{i + 1}</span>
                  <input className="input" value={c.label} maxLength={40} onChange={(e) => setCps((list) => list.map((x) => (x.id === c.id ? { ...x, label: e.target.value } : x)))} aria-label={`Name of checkpoint ${i + 1}`} />
                  <button type="button" className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
                    <ArrowUp size={14} />
                  </button>
                  <button type="button" className="icon-btn" onClick={() => move(i, 1)} disabled={i === cps.length - 1} aria-label="Move down">
                    <ArrowDown size={14} />
                  </button>
                  <button type="button" className="icon-btn" onClick={() => setCps((list) => list.filter((x) => x.id !== c.id))} aria-label="Remove">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
          {err && (
            <div className="form-error" role="alert">
              <AlertTriangle size={15} /> {err}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
              {busy ? <Loader2 size={15} className="spin" /> : <CheckCircle2 size={15} />} Save route
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ── the route code for the phone ─────────────────────────────────────── */
function RouteCodeModal({ guard, routes, onClose }: { guard: TeamRow; routes: PatrolRoute[]; onClose: () => void }) {
  const text = useMemo(() => encodeRoutePack(guard.id, guard.name, routes), [guard, routes]);
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(text, { errorCorrectionLevel: 'L', margin: 4, width: 440 })
      .then(setUrl)
      .catch(() => setErr('Too much for one code — split this guard’s routes or use fewer checkpoints.'));
  }, [text]);
  return (
    <Modal title={`Route code — ${guard.name}`} onClose={onClose}>
      <div className="c-route-code">
        {url ? <img src={url} alt={`Route code for ${guard.name}`} /> : err ? <div className="form-error">{err}</div> : <Loader2 className="spin" />}
        <div>
          <ol>
            <li>
              On {guard.name}'s phone open Park Patrol → <b>Patrol</b> → <b>Scan route code</b>.
            </li>
            <li>Point the camera at this code (or take a photo of it).</li>
            <li>The route appears on the phone's offline map. No network needed.</li>
          </ol>
          <div className="faint" style={{ fontSize: 12 }}>
            {routes.length ? `${routes.length} route${routes.length > 1 ? 's' : ''}: ${routes.map((r) => r.name).join(', ')}` : 'This guard has no active route.'} · scan again after changing a route.
          </div>
        </div>
      </div>
    </Modal>
  );
}
