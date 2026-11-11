/**
 * Dashboard — one screen: KPIs, the live feed, the map and the devices.
 *
 * The feed is the point of the demo: a record captured on a phone with no
 * signal appears here the moment the phone reconnects, highlighted, with
 * "Captured offline" and how long it waited on the phone.
 *
 * KPI cards filter the feed in place (they never navigate away).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Download, Smartphone, WifiOff, X, CheckCircle2, Clock, MapPin, User as UserIcon, Image as ImageIcon, Hourglass } from 'lucide-react';
import {
  API_URL, CITY, STATUSES, typeOf, areaOf, emirateOf, photoUrl, fmtDateTime, fmtTime, fmtDate, ago, duration, statusLabel, type Violation,
} from '../lib/api';
import { PlateChip, TypeIcon, severityChip, useNow } from '../lib/ui';
import type { Live } from './useLive';

type Filter = 'today' | 'offline' | 'new' | 'all';

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export default function DashboardPage({ live }: { live: Live }) {
  const { stats, violations, devices, fresh } = live;
  const [filter, setFilter] = useState<Filter>('today');
  const [openId, setOpenId] = useState<string | null>(null);
  const now = useNow(20_000);

  const list = useMemo(() => {
    const today = startOfToday();
    const sorted = [...violations].sort((a, b) => b.receivedAt - a.receivedAt);
    switch (filter) {
      case 'today':
        return sorted.filter((v) => v.capturedAt >= today || v.receivedAt >= today);
      case 'offline':
        return sorted.filter((v) => v.capturedOffline);
      case 'new':
        return sorted.filter((v) => v.status === 'new');
      default:
        return sorted;
    }
  }, [violations, filter]);

  const open = openId ? violations.find((v) => v.id === openId) ?? null : null;

  async function exportCsv() {
    const raw = localStorage.getItem('pp.console.session');
    const token = raw ? JSON.parse(raw).token : '';
    const res = await fetch(`${API_URL}/api/export.csv`, { headers: { Authorization: `Bearer ${token}` } });
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `violations-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  return (
    <>
      <div className="c-kpis">
        <Kpi label="Violations today" value={stats?.today ?? 0} sub={`${stats?.total ?? 0} on record`} active={filter === 'today'} onClick={() => setFilter('today')} />
        <Kpi
          label="Captured offline"
          value={stats?.offlineTotal ?? 0}
          sub={`${stats?.todayOffline ?? 0} today · synced later`}
          tone="warning"
          active={filter === 'offline'}
          onClick={() => setFilter('offline')}
        />
        <Kpi label="Awaiting review" value={stats?.awaitingReview ?? 0} sub="status: New" tone="info" active={filter === 'new'} onClick={() => setFilter('new')} />
        <Kpi
          label="Devices online"
          value={`${devices.filter((x) => x.online).length}/${devices.length}`}
          sub={`${stats?.guardsActive ?? 0} guards active`}
          tone="success"
          active={filter === 'all'}
          onClick={() => setFilter('all')}
          hint="Show all records"
        />
      </div>

      <div className="c-grid">
        <section className="card c-feed">
          <div className="card-head">
            <div>
              <h3>Violations</h3>
              <div className="faint" style={{ fontSize: 12 }}>
                {filter === 'today' ? 'Today' : filter === 'offline' ? 'Captured offline, synced later' : filter === 'new' ? 'Awaiting review' : 'All records'} · newest first · {list.length}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <select className="select c-select" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Filter">
                <option value="today">Today</option>
                <option value="offline">Captured offline</option>
                <option value="new">Awaiting review</option>
                <option value="all">All</option>
              </select>
              <button className="btn btn-sm" onClick={() => void exportCsv()}>
                <Download size={14} /> CSV
              </button>
            </div>
          </div>
          <div className="c-table-wrap">
            <table className="c-table">
              <thead>
                <tr>
                  <th>Plate</th>
                  <th>Violation</th>
                  <th>Where</th>
                  <th>Guard</th>
                  <th>Captured</th>
                  <th>Received</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {list.length === 0 && (
                  <tr>
                    <td colSpan={7} className="c-empty">
                      Nothing here yet.
                    </td>
                  </tr>
                )}
                {list.map((v) => {
                  const t = typeOf(v.type);
                  const waited = v.receivedAt - v.capturedAt;
                  return (
                    <tr key={v.id} className={`${fresh.has(v.id) ? 'is-fresh' : ''}${openId === v.id ? ' is-open' : ''}`} onClick={() => setOpenId(v.id)}>
                      <td>
                        <PlateChip plate={v.plate} />
                      </td>
                      <td>
                        <div className="c-type">
                          <span className={`c-type-icon ${severityChip(v.severity)}`}>
                            <TypeIcon icon={t?.icon} size={15} />
                          </span>
                          <span>{t?.short ?? v.type}</span>
                        </div>
                      </td>
                      <td className="c-ellipsis" title={areaOf(v.location?.areaId)?.label}>{areaOf(v.location?.areaId)?.label.replace(/ \(.*\)$/, '') ?? '—'}</td>
                      <td className="c-ellipsis">{v.guardName}</td>
                      <td>
                        <div>{fmtTime(v.capturedAt)}</div>
                        <div className="faint" style={{ fontSize: 11 }}>
                          {fmtDate(v.capturedAt)}
                        </div>
                      </td>
                      <td>
                        {v.capturedOffline ? (
                          <span className="chip chip-warning" title={`Stored on the phone for ${duration(waited)} before upload`}>
                            <WifiOff size={12} /> Offline · synced {duration(waited)} later
                          </span>
                        ) : (
                          <span className="chip chip-success">
                            <CheckCircle2 size={12} /> Live
                          </span>
                        )}
                        {fresh.has(v.id) && <span className="chip chip-accent c-just">just synced</span>}
                      </td>
                      <td>
                        <StatusChip status={v.status} />
                        {v.seeded && <span className="c-sample">sample</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <div className="c-side">
          <section className="card">
            <div className="card-head">
              <h3>Map</h3>
              <span className="faint" style={{ fontSize: 12 }}>
                {list.filter((v) => v.location?.gps).length} with GPS
              </span>
            </div>
            <ViolationMap list={list} openId={openId} fresh={fresh} onOpen={setOpenId} />
          </section>

          <section className="card">
            <div className="card-head">
              <h3>Devices</h3>
              <span className="faint" style={{ fontSize: 12 }}>
                {devices.filter((d) => d.online).length} online
              </span>
            </div>
            <div className="c-devices">
              {devices.length === 0 && <div className="c-empty">No phone has connected yet. Open /app on a phone and sign in.</div>}
              {devices.map((d) => (
                <div key={d.deviceId} className="c-device">
                  <span className={`dot ${d.online ? 'dot-on' : 'dot-off'}`} />
                  <Smartphone size={16} className="faint" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="c-ellipsis" style={{ fontWeight: 700 }}>
                      {d.userName ?? '—'}
                    </div>
                    <div className="faint c-ellipsis" style={{ fontSize: 12 }}>
                      {d.label}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', fontSize: 12 }}>
                    <div className={d.online ? '' : 'faint'}>{d.online ? 'Online' : `Offline · ${ago(d.lastSeen, now)}`}</div>
                    <div className="faint">{d.lastSync ? `last upload ${ago(d.lastSync, now)}` : 'no uploads yet'}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      {open && <ViolationDrawer v={open} onClose={() => setOpenId(null)} onStatus={(s) => void live.setStatus(open.id, s)} />}
    </>
  );
}

function Kpi({ label, value, sub, tone, active, onClick, hint }: { label: string; value: number | string; sub: string; tone?: 'warning' | 'info' | 'success'; active: boolean; onClick: () => void; hint?: string }) {
  return (
    <button className={`card c-kpi${active ? ' is-active' : ''}${tone ? ` c-kpi-${tone}` : ''}`} onClick={onClick} title={hint ?? `Show: ${label}`}>
      <div className="eyebrow">{label}</div>
      <div className="kpi-value">{value}</div>
      <div className="faint" style={{ fontSize: 12 }}>
        {sub}
      </div>
    </button>
  );
}

export function StatusChip({ status }: { status: string }) {
  const cls = status === 'new' ? 'chip-info' : status === 'actioned' ? 'chip-success' : status === 'dismissed' ? '' : 'chip-accent';
  return <span className={`chip ${cls}`}>{statusLabel(status)}</span>;
}

/* ── map ─────────────────────────────────────────────────────────────── */
function ViolationMap({ list, openId, fresh, onOpen }: { list: Violation[]; openId: string | null; fresh: Set<string>; onOpen: (id: string) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const fitted = useRef(false);

  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = L.map(el.current, { zoomControl: true, attributionControl: true }).setView([CITY.lat, CITY.lng], CITY.zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    if (!map.current || !layer.current) return;
    layer.current.clearLayers();
    // Leaflet writes colours into SVG attributes, which cannot read CSS variables — resolve the tokens.
    const css = getComputedStyle(document.documentElement);
    const tok = (n: string) => css.getPropertyValue(n).trim();
    const pts: L.LatLngExpression[] = [];
    for (const v of list) {
      const g = v.location?.gps;
      if (!g) continue;
      pts.push([g.lat, g.lng]);
      const isFresh = fresh.has(v.id);
      const color = tok(v.severity === 'high' ? '--app-danger' : v.severity === 'medium' ? '--app-warning' : '--app-info');
      const m = L.circleMarker([g.lat, g.lng], {
        radius: isFresh || v.id === openId ? 10 : 6,
        color: v.id === openId ? tok('--app-accent') : color,
        weight: isFresh || v.id === openId ? 3 : 1.5,
        fillColor: color,
        fillOpacity: 0.75,
        className: isFresh ? 'c-pin-fresh' : '',
      });
      m.bindTooltip(`${typeOf(v.type)?.short ?? v.type} · ${[v.plate?.code, v.plate?.number].filter(Boolean).join(' ')}`);
      m.on('click', () => onOpen(v.id));
      m.addTo(layer.current);
    }
    if (!fitted.current && pts.length) {
      map.current.fitBounds(L.latLngBounds(pts), { padding: [24, 24], maxZoom: 14 });
      fitted.current = true;
    }
  }, [list, openId, fresh, onOpen]);

  // Fly to a freshly synced record so the room sees where it happened.
  useEffect(() => {
    const id = [...fresh].pop();
    const v = id && list.find((x) => x.id === id);
    if (v && v.location?.gps && map.current) map.current.flyTo([v.location.gps.lat, v.location.gps.lng], 15, { duration: 0.8 });
  }, [fresh, list]);

  return <div ref={el} className="c-map" />;
}

/* ── drawer ──────────────────────────────────────────────────────────── */
function ViolationDrawer({ v, onClose, onStatus }: { v: Violation; onClose: () => void; onStatus: (s: string) => void }) {
  const t = typeOf(v.type);
  const waited = v.receivedAt - v.capturedAt;
  const [zoom, setZoom] = useState<string | null>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && (zoom ? setZoom(null) : onClose());
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose, zoom]);
  return (
    <div className="c-drawer-wrap" onClick={onClose}>
      <aside className="c-drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Violation details">
        <div className="c-drawer-head">
          <div>
            <div className="eyebrow mono">{v.ref}</div>
            <h2 style={{ fontSize: 18, marginTop: 4 }}>{t?.label ?? v.type}</h2>
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              <span className={`chip ${severityChip(v.severity)}`}>{v.severity} severity</span>
              <StatusChip status={v.status} />
              {v.capturedOffline && (
                <span className="chip chip-warning">
                  <WifiOff size={12} /> Captured offline
                </span>
              )}
              {v.seeded && <span className="chip">Sample record</span>}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="c-drawer-body">
          <div className="c-plate-block">
            <PlateChip plate={v.plate} large />
            <div className="faint" style={{ fontSize: 12 }}>
              {emirateOf(v.plate?.emirate)?.label} · {v.plate?.source === 'ocr' ? `read on the phone${v.plate.confidence ? ` (${v.plate.confidence}%)` : ''}, confirmed by guard` : 'typed by guard'}
            </div>
          </div>

          <div className="c-photos">
            {v.photos.length === 0 ? (
              <div className="c-nophoto">
                <ImageIcon size={20} /> {v.seeded ? 'Sample record — no photo' : 'No photo'}
              </div>
            ) : (
              v.photos.map((p) => (
                <figure key={p.kind} onClick={() => setZoom(photoUrl(p.url))}>
                  <img src={photoUrl(p.url)} alt={p.kind} loading="lazy" />
                  <figcaption>{p.kind === 'vehicle' ? 'Vehicle (evidence)' : 'Plate close-up'}</figcaption>
                </figure>
              ))
            )}
          </div>

          <dl className="c-dl">
            <dt>
              <MapPin size={14} /> Location
            </dt>
            <dd>
              {areaOf(v.location?.areaId)?.label ?? '—'}
              {v.location?.landmark && <div>{v.location.landmark}</div>}
              {v.location?.gps && (
                <div className="faint mono" style={{ fontSize: 12 }}>
                  {v.location.gps.lat.toFixed(5)}, {v.location.gps.lng.toFixed(5)}
                  {v.location.gps.accuracy ? ` (±${Math.round(v.location.gps.accuracy)} m)` : ''}{' '}
                  <a href={`https://www.openstreetmap.org/?mlat=${v.location.gps.lat}&mlon=${v.location.gps.lng}#map=18/${v.location.gps.lat}/${v.location.gps.lng}`} target="_blank" rel="noreferrer">
                    open map
                  </a>
                </div>
              )}
            </dd>
            <dt>
              <UserIcon size={14} /> Guard
            </dt>
            <dd>
              {v.guardName}
              <div className="faint" style={{ fontSize: 12 }}>
                {v.deviceLabel}
              </div>
            </dd>
            {v.notes && (
              <>
                <dt>Notes</dt>
                <dd>{v.notes}</dd>
              </>
            )}
          </dl>

          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>
              Timeline
            </div>
            <ol className="c-timeline">
              <li>
                <span className="c-tl-dot c-tl-warn">
                  <Clock size={12} />
                </span>
                <div>
                  <b>Captured on the phone</b> {v.capturedOffline ? '(no connection)' : ''}
                  <div className="faint">{fmtDateTime(v.capturedAt)}</div>
                  {v.clockSkewMs ? <div className="faint">Phone clock was off by {duration(Math.abs(v.clockSkewMs))}; time corrected.</div> : null}
                </div>
              </li>
              {v.capturedOffline && (
                <li>
                  <span className="c-tl-dot">
                    <Hourglass size={12} />
                  </span>
                  <div>
                    <b>Stored on the phone</b>
                    <div className="faint">{duration(waited)} waiting for a connection</div>
                  </div>
                </li>
              )}
              <li>
                <span className="c-tl-dot c-tl-ok">
                  <CheckCircle2 size={12} />
                </span>
                <div>
                  <b>Received by the server</b>
                  <div className="faint">{fmtDateTime(v.receivedAt)}</div>
                </div>
              </li>
              {v.history
                .filter((h) => h.action.startsWith('Status'))
                .map((h, i) => (
                  <li key={i}>
                    <span className="c-tl-dot c-tl-accent">
                      <CheckCircle2 size={12} />
                    </span>
                    <div>
                      <b>{h.action.replace('Status: ', 'Status ')}</b>
                      <div className="faint">
                        {h.by} · {fmtDateTime(h.at)}
                      </div>
                    </div>
                  </li>
                ))}
            </ol>
          </div>
        </div>

        <div className="c-drawer-foot">
          {STATUSES.filter((s) => s.id !== v.status && s.id !== 'new').map((s) => (
            <button key={s.id} className={`btn btn-sm${s.id === 'actioned' ? ' btn-primary' : ''}`} onClick={() => onStatus(s.id)}>
              {s.id === 'reviewed' ? 'Mark reviewed' : s.id === 'actioned' ? 'Issue fine' : 'Dismiss'}
            </button>
          ))}
        </div>
      </aside>
      {zoom && (
        <div className="c-zoom" onClick={(e) => (e.stopPropagation(), setZoom(null))}>
          <img src={zoom} alt="" />
        </div>
      )}
    </div>
  );
}
