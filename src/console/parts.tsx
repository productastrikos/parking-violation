/**
 * Dashboard building blocks shared by the pages: KPI card, status chip, the
 * map (violations · guard positions · hotspots), the record drawer (view, edit,
 * void, restore, guard correction, AI plate check, history) and modals.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  AlertTriangle, Ban, CheckCircle2, Clock, Flag, Hourglass, Image as ImageIcon, Loader2, MapPin, Pencil, RotateCcw, Save, ScanLine, Sparkles, User as UserIcon, WifiOff, X, Gavel, Eye, History,
} from 'lucide-react';
import {
  AREAS, CITY, EMIRATES, STATUSES, VIOLATION_TYPES, areaOf, duration, emirateOf, fmtDateTime, photoUrl, statusLabel, typeOf, type Device, type Hotspot, type Violation,
} from '../lib/api';
import { PlateChip, TypeIcon, severityChip } from '../lib/ui';
import type { EditChanges, Live } from './useLive';

/* ── toast ─────────────────────────────────────────────────────────────── */
const ToastCtx = createContext<(text: string, tone?: 'ok' | 'error') => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastHost({ children }: { children: React.ReactNode }) {
  const [t, setT] = useState<{ text: string; tone: 'ok' | 'error'; k: number } | null>(null);
  const show = useCallback((text: string, tone: 'ok' | 'error' = 'ok') => setT({ text, tone, k: Date.now() }), []);
  useEffect(() => {
    if (!t) return;
    const id = setTimeout(() => setT(null), 3600);
    return () => clearTimeout(id);
  }, [t]);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {t && (
        <div className="toast c-toast" key={t.k} role="status">
          {t.tone === 'ok' ? <CheckCircle2 size={18} color="var(--app-success)" /> : <AlertTriangle size={18} color="var(--app-danger)" />} {t.text}
        </div>
      )}
    </ToastCtx.Provider>
  );
}

/* ── small parts ───────────────────────────────────────────────────────── */
export function StatusChip({ v }: { v: Pick<Violation, 'status' | 'voided'> }) {
  if (v.voided)
    return (
      <span className="chip chip-danger">
        <Ban size={11} /> Voided
      </span>
    );
  const cls = v.status === 'new' ? 'chip-info' : v.status === 'actioned' ? 'chip-success' : v.status === 'dismissed' ? '' : 'chip-accent';
  return <span className={`chip ${cls}`}>{statusLabel(v.status)}</span>;
}

export function Kpi({ label, value, sub, tone, active, onClick, hint }: { label: string; value: number | string; sub: string; tone?: 'warning' | 'info' | 'success' | 'danger' | 'advisory'; active?: boolean; onClick?: () => void; hint?: string }) {
  return (
    <button className={`card c-kpi${active ? ' is-active' : ''}${tone ? ` c-kpi-${tone}` : ''}${onClick ? '' : ' c-kpi-static'}`} onClick={onClick} title={hint ?? (onClick ? `Show: ${label}` : undefined)} disabled={!onClick}>
      <div className="eyebrow">{label}</div>
      <div className="kpi-value">{value}</div>
      <div className="faint" style={{ fontSize: 12 }}>
        {sub}
      </div>
    </button>
  );
}

export function Modal({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="c-modal-wrap" onClick={onClose}>
      <div className={`card c-modal${wide ? ' is-wide' : ''}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="card-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="card-pad">{children}</div>
      </div>
    </div>
  );
}

export function ReasonModal({ title, body, confirm, danger, quick = [], onSubmit, onClose }: { title: string; body: string; confirm: string; danger?: boolean; quick?: string[]; onSubmit: (reason: string) => Promise<void>; onClose: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="c-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr(null);
          try {
            await onSubmit(text.trim());
          } catch (x) {
            setErr((x as Error).message);
            setBusy(false);
          }
        }}
      >
        <p className="muted" style={{ margin: 0 }}>
          {body}
        </p>
        {quick.length > 0 && (
          <div className="c-quick">
            {quick.map((q) => (
              <button type="button" key={q} className={`chip${text === q ? ' chip-accent' : ''}`} onClick={() => setText(q)}>
                {q}
              </button>
            ))}
          </div>
        )}
        <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder="Reason (kept in the audit trail)" autoFocus />
        {err && (
          <div className="form-error">
            <AlertTriangle size={16} /> {err}
          </div>
        )}
        <div className="c-form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy || text.trim().length < 3}>
            {busy && <Loader2 size={15} className="spin" />} {confirm}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ── map ───────────────────────────────────────────────────────────────── */
export function MapView({
  violations = [],
  devices = [],
  hotspots = [],
  focusId,
  focusArea,
  fresh,
  onOpen,
  height = 340,
}: {
  violations?: Violation[];
  devices?: Device[];
  hotspots?: Hotspot[];
  focusId?: string | null;
  focusArea?: string | null;
  fresh?: Set<string>;
  onOpen?: (id: string) => void;
  height?: number;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const fitted = useRef(false);

  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = L.map(el.current, { zoomControl: true, attributionControl: true }).setView([CITY.lat, CITY.lng], CITY.zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    const ro = new ResizeObserver(() => map.current?.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
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

    for (const h of hotspots.slice(0, 8)) {
      L.circle([h.lat, h.lng], { radius: 350 + h.count7 * 45, color: tok('--app-advisory'), weight: 1, fillColor: tok('--app-advisory'), fillOpacity: 0.12 })
        .bindTooltip(`${h.label} · ${h.count7} this week · peak ${h.peakWindow}`)
        .addTo(layer.current);
    }
    for (const v of violations) {
      const g = v.location?.gps;
      if (!g || v.voided) continue;
      pts.push([g.lat, g.lng]);
      const isFresh = fresh?.has(v.id);
      const color = tok(v.severity === 'high' ? '--app-danger' : v.severity === 'medium' ? '--app-warning' : '--app-info');
      const m = L.circleMarker([g.lat, g.lng], {
        radius: isFresh || v.id === focusId ? 10 : 6,
        color: v.id === focusId ? tok('--app-accent') : color,
        weight: isFresh || v.id === focusId ? 3 : 1.5,
        fillColor: color,
        fillOpacity: 0.78,
        className: isFresh ? 'c-pin-fresh' : '',
      });
      m.bindTooltip(`${typeOf(v.type)?.short ?? v.type} · ${[v.plate?.code, v.plate?.number].filter(Boolean).join(' ')}${g.demo ? ' · demo GPS' : ''}`);
      if (onOpen) m.on('click', () => onOpen(v.id));
      m.addTo(layer.current);
    }
    for (const d of devices) {
      if (!d.position) continue;
      const stale = !d.online || Date.now() - d.position.at > 10 * 60_000;
      const icon = L.divIcon({
        className: '',
        html: `<div class="c-guard-pin${stale ? ' is-stale' : ''}"><span>${(d.userName ?? '?').split(' ').map((p) => p[0]).slice(0, 2).join('')}</span></div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      });
      L.marker([d.position.lat, d.position.lng], { icon, zIndexOffset: 1000 })
        .bindTooltip(`${d.userName ?? 'Guard'} · ${d.online ? 'online' : 'offline'}${d.position.demo ? ' · DEMO position' : ''}`)
        .addTo(layer.current);
      if (!violations.length) pts.push([d.position.lat, d.position.lng]);
    }
    if (!fitted.current && pts.length) {
      map.current.fitBounds(L.latLngBounds(pts), { padding: [24, 24], maxZoom: 14 });
      fitted.current = true;
    }
  }, [violations, devices, hotspots, focusId, fresh, onOpen]);

  // Fly to a freshly synced record so the room sees where it happened.
  useEffect(() => {
    const id = fresh ? [...fresh].pop() : undefined;
    const v = id && violations.find((x) => x.id === id);
    if (v && v.location?.gps && map.current) map.current.flyTo([v.location.gps.lat, v.location.gps.lng], 15, { duration: 0.8 });
  }, [fresh, violations]);

  useEffect(() => {
    const a = focusArea ? AREAS.find((x) => x.id === focusArea) : null;
    if (a && map.current) map.current.flyTo([a.lat, a.lng], 14, { duration: 0.6 });
  }, [focusArea]);

  return <div ref={el} className="c-map" style={{ height }} />;
}

/* ── record drawer ─────────────────────────────────────────────────────── */
type Mode = 'view' | 'edit';

export function ViolationDrawer({ v, live, onClose, startInEdit = false }: { v: Violation; live: Live; onClose: () => void; startInEdit?: boolean }) {
  const toast = useToast();
  const [mode, setMode] = useState<Mode>(startInEdit && !v.voided ? 'edit' : 'view');
  const [zoom, setZoom] = useState<string | null>(null);
  const [ask, setAsk] = useState<'void' | 'dismiss' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const t = typeOf(v.type);
  const waited = v.receivedAt - v.capturedAt;

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || ask) return;
      if (zoom) setZoom(null);
      else if (mode === 'edit') setMode('view');
      else onClose();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose, zoom, mode, ask]);

  async function act(label: string, fn: () => Promise<void>, ok: string) {
    setBusy(label);
    try {
      await fn();
      toast(ok);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  const pc = v.ai?.plateCheck;

  return (
    <div className="c-drawer-wrap" onClick={onClose}>
      <aside className="c-drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Violation details">
        <div className="c-drawer-head">
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow mono">{v.ref}</div>
            <h2 style={{ fontSize: 18, marginTop: 4 }}>{mode === 'edit' ? 'Edit record' : t?.label ?? v.type}</h2>
            {mode === 'view' && (
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                <span className={`chip ${severityChip(v.severity)}`}>{v.severity} severity</span>
                <StatusChip v={v} />
                {v.capturedOffline && (
                  <span className="chip chip-warning">
                    <WifiOff size={11} /> Captured offline
                  </span>
                )}
                {(v.edits?.length ?? 0) > 0 && (
                  <span className="chip chip-accent">
                    <Pencil size={11} /> Edited ×{v.edits!.length}
                  </span>
                )}
                {v.seeded && <span className="chip">Sample record</span>}
              </div>
            )}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        {mode === 'edit' ? (
          <EditForm v={v} live={live} onDone={() => setMode('view')} />
        ) : (
          <>
            <div className="c-drawer-body">
              {v.voided && (
                <div className="c-callout tone-danger">
                  <Ban size={16} />
                  <div>
                    <b>Voided</b> by {v.voidedBy} · {fmtDateTime(v.voidedAt)}
                    <div className="muted">"{v.voidReason}" — excluded from KPIs and fines; kept for the audit.</div>
                  </div>
                </div>
              )}
              {v.correction?.state === 'pending' && (
                <div className="c-callout tone-warning">
                  <Flag size={16} />
                  <div style={{ flex: 1 }}>
                    <b>{v.correction.by} reports this record as a mistake</b>
                    <div className="muted">"{v.correction.reason}" · {fmtDateTime(v.correction.at)}</div>
                    <div className="c-callout-actions">
                      <button className="btn btn-sm btn-danger" onClick={() => setAsk('void')}>
                        <Ban size={14} /> Agree — void it
                      </button>
                      <button className="btn btn-sm" onClick={() => setMode('edit')}>
                        <Pencil size={14} /> Correct it
                      </button>
                      <button className="btn btn-sm btn-ghost" onClick={() => setAsk('dismiss')}>
                        Keep as is
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="c-plate-block">
                <PlateChip plate={v.plate} large />
                <div className="faint" style={{ fontSize: 12 }}>
                  {emirateOf(v.plate?.emirate)?.label} ·{' '}
                  {v.plate?.source === 'ocr' ? `read on the phone${v.plate.confidence ? ` (${v.plate.confidence}%)` : ''}, confirmed by guard` : (v.plate as { correctedBy?: string }).correctedBy ? `corrected by ${(v.plate as { correctedBy?: string }).correctedBy}` : 'typed by guard'}
                </div>
                {pc &&
                  (pc.ok ? (
                    <div className={`c-ai-check ${pc.agrees ? 'is-ok' : 'is-diff'}`}>
                      <Sparkles size={14} />
                      {pc.agrees ? (
                        <span>
                          AI check agrees ({pc.confidence ?? '–'}%) · {pc.label}
                        </span>
                      ) : pc.readable && pc.read?.number ? (
                        <span>
                          AI reads <b className="mono">{[pc.read.code, pc.read.number].filter(Boolean).join(' ')}</b> — differs from the guard's entry · {pc.label}
                        </span>
                      ) : (
                        <span>AI could not read the plate: {pc.note ?? 'unreadable'}</span>
                      )}
                    </div>
                  ) : (
                    <div className="c-ai-check">
                      <Sparkles size={14} /> AI check unavailable: {pc.note}
                    </div>
                  ))}
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
                      {v.location.gps.accuracy ? ` (±${Math.round(v.location.gps.accuracy)} m)` : ''}
                      {v.location.gps.demo && <span className="chip chip-accent c-demo">DEMO GPS</span>}{' '}
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
                    .filter((h) => !/^Captured|^Received/.test(h.action))
                    .map((h, i) => (
                      <li key={i}>
                        <span className="c-tl-dot c-tl-accent">{/Void/.test(h.action) ? <Ban size={12} /> : /Edit/.test(h.action) ? <Pencil size={12} /> : /mistake|Correction/i.test(h.action) ? <Flag size={12} /> : <Gavel size={12} />}</span>
                        <div>
                          <b>{h.action.replace('Status: ', 'Status ')}</b>
                          <div className="faint">
                            {h.by} · {fmtDateTime(h.at)}
                            {h.note ? ` · "${h.note}"` : ''}
                          </div>
                        </div>
                      </li>
                    ))}
                </ol>
              </div>

              {(v.edits?.length ?? 0) > 0 && (
                <div>
                  <div className="eyebrow" style={{ marginBottom: 8 }}>
                    <History size={12} style={{ verticalAlign: '-1px' }} /> Changes
                  </div>
                  {v.edits!.map((e, i) => (
                    <div key={i} className="c-edit">
                      <div className="faint" style={{ fontSize: 12 }}>
                        {e.by} · {fmtDateTime(e.at)} · "{e.reason}"
                      </div>
                      {Object.entries(e.changes).map(([k, c]) => (
                        <div key={k} className="c-edit-row">
                          <span className="c-edit-k">{k.replace('plate.', 'plate ').replace('location.', '').replace('areaId', 'area')}</span>
                          <span className="c-edit-from">{fmtVal(k, c.from)}</span>→<span className="c-edit-to">{fmtVal(k, c.to)}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="c-drawer-foot">
              {v.voided ? (
                <button className="btn btn-sm" disabled={!!busy} onClick={() => void act('restore', () => live.restore(v.id), 'Record restored')}>
                  {busy === 'restore' ? <Loader2 size={14} className="spin" /> : <RotateCcw size={14} />} Restore
                </button>
              ) : (
                <>
                  <button className="btn btn-sm btn-ghost c-void-btn" onClick={() => setAsk('void')}>
                    <Ban size={14} /> Void
                  </button>
                  <button className="btn btn-sm" onClick={() => setMode('edit')}>
                    <Pencil size={14} /> Edit
                  </button>
                  {!v.seeded && v.photos.length > 0 && live.intel?.ai?.vision && (
                    <button className="btn btn-sm" disabled={!!busy} onClick={() => void act('ai', () => live.plateCheck(v.id), 'AI plate check done')}>
                      {busy === 'ai' ? <Loader2 size={14} className="spin" /> : <ScanLine size={14} />} AI check
                    </button>
                  )}
                  <span style={{ flex: 1 }} />
                  {STATUSES.filter((s) => s.id !== v.status && s.id !== 'new').map((s) => (
                    <button key={s.id} disabled={!!busy} className={`btn btn-sm${s.id === 'actioned' ? ' btn-primary' : ''}`} onClick={() => void act(s.id, () => live.setStatus(v.id, s.id), `${v.ref}: ${s.label}`)}>
                      {busy === s.id && <Loader2 size={14} className="spin" />}
                      {s.id === 'reviewed' ? (
                        <>
                          <Eye size={14} /> Reviewed
                        </>
                      ) : s.id === 'actioned' ? (
                        <>
                          <Gavel size={14} /> Issue fine
                        </>
                      ) : (
                        'Dismiss'
                      )}
                    </button>
                  ))}
                </>
              )}
            </div>
          </>
        )}
      </aside>
      {zoom && (
        <div className="c-zoom" onClick={(e) => (e.stopPropagation(), setZoom(null))}>
          <img src={zoom} alt="" />
        </div>
      )}
      {ask === 'void' && (
        <ReasonModal
          title={`Void ${v.ref}`}
          body="A voided record is removed from KPIs, fines and exports of live records. It is not deleted — it stays in the audit trail and can be restored."
          confirm="Void record"
          danger
          quick={v.correction?.state === 'pending' ? [`Guard: ${v.correction.reason}`, 'Recorded by mistake', 'Duplicate record'] : ['Recorded by mistake', 'Duplicate record', 'Vehicle had a valid permit', 'Wrong vehicle photographed']}
          onClose={() => setAsk(null)}
          onSubmit={async (r) => {
            await live.voidRecord(v.id, r);
            toast(`${v.ref} voided`);
            setAsk(null);
          }}
        />
      )}
      {ask === 'dismiss' && (
        <ReasonModal
          title="Keep the record"
          body={`Tell ${v.correction?.by ?? 'the guard'} why the record stands. They see it on their phone.`}
          confirm="Keep record"
          quick={['Photo shows the violation clearly', 'Plate checked — record is correct']}
          onClose={() => setAsk(null)}
          onSubmit={async (r) => {
            await live.dismissCorrection(v.id, r);
            toast('Correction request dismissed');
            setAsk(null);
          }}
        />
      )}
    </div>
  );
}

function fmtVal(k: string, x: unknown) {
  if (x === null || x === undefined || x === '') return '—';
  if (k === 'type') return typeOf(String(x))?.short ?? String(x);
  if (k === 'location.areaId') return areaOf(String(x))?.label ?? String(x);
  if (k === 'plate.emirate') return emirateOf(String(x))?.label ?? String(x);
  return String(x);
}

function EditForm({ v, live, onDone }: { v: Violation; live: Live; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    emirate: v.plate.emirate,
    code: v.plate.code,
    number: v.plate.number,
    type: v.type,
    severity: v.severity as string,
    areaId: v.location.areaId,
    landmark: v.location.landmark,
    notes: v.notes,
  });
  const [reason, setReason] = useState(v.correction?.state === 'pending' ? `Guard reported: ${v.correction.reason}` : '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const changes: EditChanges = {};
  if (f.emirate !== v.plate.emirate || f.code !== v.plate.code || f.number !== v.plate.number) changes.plate = { emirate: f.emirate, code: f.code, number: f.number };
  if (f.type !== v.type) changes.type = f.type;
  if (f.severity !== v.severity) changes.severity = f.severity;
  if (f.notes !== v.notes) changes.notes = f.notes;
  if (f.areaId !== v.location.areaId || f.landmark !== v.location.landmark) changes.location = { areaId: f.areaId, landmark: f.landmark };
  const dirty = Object.keys(changes).length > 0;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await live.edit(v.id, changes, reason);
      toast(`${v.ref} updated`);
      onDone();
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="c-drawer-form" onSubmit={save}>
      <div className="c-drawer-body">
        <div className="field">
          <label>Number plate</label>
          <div className="c-plate-edit">
            <select className="select" value={f.emirate} onChange={set('emirate')} aria-label="Emirate">
              {EMIRATES.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </select>
            <input className="input" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) })} placeholder="Code" aria-label="Code" />
            <input className="input mono" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value.replace(/\D/g, '').slice(0, 5) })} placeholder="Number" aria-label="Number" />
          </div>
          {v.photos.find((p) => p.kind === 'plate') && (
            <img className="c-plate-ref" src={photoUrl(v.photos.find((p) => p.kind === 'plate')!.url)} alt="Plate photo for reference" />
          )}
        </div>
        <div className="c-form-2">
          <div className="field">
            <label>Violation</label>
            <select className="select" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value, severity: VIOLATION_TYPES.find((t) => t.id === e.target.value)?.severity ?? f.severity })}>
              {VIOLATION_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Severity</label>
            <select className="select" value={f.severity} onChange={set('severity')}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>
        <div className="c-form-2">
          <div className="field">
            <label>Area</label>
            <select className="select" value={f.areaId} onChange={set('areaId')}>
              <option value="">—</option>
              {AREAS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Landmark</label>
            <input className="input" value={f.landmark} onChange={set('landmark')} />
          </div>
        </div>
        <div className="field">
          <label>Notes</label>
          <textarea className="textarea" value={f.notes} onChange={set('notes')} />
        </div>
        <div className="field">
          <label>Reason for the change (required, kept in the audit trail)</label>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Plate misread by the guard — checked against the photo" />
        </div>
        {err && (
          <div className="form-error">
            <AlertTriangle size={16} /> {err}
          </div>
        )}
        <p className="faint" style={{ fontSize: 12, margin: 0 }}>
          The original values are kept: every change is recorded with who, when and why.
        </p>
      </div>
      <div className="c-drawer-foot">
        <button type="button" className="btn btn-sm" onClick={onDone}>
          Cancel
        </button>
        <span style={{ flex: 1 }} />
        <button className="btn btn-sm btn-primary" disabled={busy || !dirty || reason.trim().length < 3}>
          {busy ? <Loader2 size={14} className="spin" /> : <Save size={14} />} Save changes
        </button>
      </div>
    </form>
  );
}

export function TypeCell({ v }: { v: Violation }) {
  const t = typeOf(v.type);
  return (
    <div className="c-type">
      <span className={`c-type-icon ${severityChip(v.severity)}`}>
        <TypeIcon icon={t?.icon} size={15} />
      </span>
      <span>{t?.short ?? v.type}</span>
    </div>
  );
}
