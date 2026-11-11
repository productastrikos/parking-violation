/**
 * The guard app — what a security guard uses on patrol. Installable to the
 * Home Screen (Android and iPhone) and fully usable with no network:
 *
 *   sign in (offline after the first time) → record a violation → it is saved
 *   on the phone at once → it uploads by itself when the phone is back online.
 *
 * State lives in IndexedDB (offline/db.ts); this file is screens only. The
 * connection badge in the header is the honest one from the sync engine: green
 * means OUR server answered, not merely that Wi-Fi is on.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  AlertTriangle, Camera, CheckCircle2, ChevronRight, Eye, EyeOff, Home, List, Loader2, Lock, LogOut, PlusSquare, RefreshCw,
  Settings, Share, Smartphone, Trash2, User as UserIcon, WifiOff, X, RotateCcw, UploadCloud, Hourglass, Info,
} from 'lucide-react';
import { registerSW } from 'virtual:pwa-register';
import { request, ApiError, APP_VERSION, typeOf, areaOf, fmtDateTime, fmtTime, ago, type User } from '../lib/api';
import { Brand, PlateChip, TypeIcon, useNow } from '../lib/ui';
import { allRecords, deleteUnsynced, photosFor, pruneSynced, type LocalRecord } from './offline/db';
import {
  getSession, setSession, clearSession, verifyOffline, rememberCredential, lastUsername, setLastUsername, type Session,
} from './offline/offlineAuth';
import { deviceInfo, renameDevice, platformLabel, isIOS, isStandalone, requestPersistence } from './offline/device';
import {
  getStatus, subscribe, syncNow, startSyncEngine, connectSocket, disconnectSocket, onRecordsChanged, requeueFor, retryRecord, probe, recordsChanged,
} from './offline/sync';
import { warmUpOcr } from './offline/plateOcr';
import CaptureFlow from './CaptureFlow';
import './guard.css';

type Tab = 'home' | 'records' | 'settings';

const useSync = () => useSyncExternalStore(subscribe, getStatus);

function useRecords() {
  const [recs, setRecs] = useState<LocalRecord[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => void allRecords().then((r) => alive && setRecs(r));
    load();
    const off = onRecordsChanged(load);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return recs;
}

/* ── service worker: offline shell + update prompt ──────────────────────── */
let updateSW: ((reload?: boolean) => Promise<void>) | null = null;
const swListeners = new Set<() => void>();
let swState: { needRefresh: boolean; offlineReady: boolean } = { needRefresh: false, offlineReady: false };
function setSw(p: Partial<typeof swState>) {
  swState = { ...swState, ...p };
  swListeners.forEach((l) => l());
}
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh: () => setSw({ needRefresh: true }),
    onOfflineReady: () => setSw({ offlineReady: true }),
  });
  // Already controlled by a SW → the shell is cached.
  if (navigator.serviceWorker.controller) swState.offlineReady = true;
}
const useSw = () =>
  useSyncExternalStore(
    (cb) => {
      swListeners.add(cb);
      return () => swListeners.delete(cb);
    },
    () => swState,
  );

/* ══════════════════════════════════════════════════════════════════════ */

export default function GuardApp() {
  const [session, setS] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    void getSession().then((s) => setS(s ?? null));
    void deviceInfo();
    void requestPersistence();
    void pruneSynced();
    startSyncEngine();
  }, []);

  useEffect(() => {
    if (session) {
      void connectSocket();
      warmUpOcr();
    } else disconnectSocket();
  }, [session]);

  if (session === undefined) return <div className="g-boot" />;
  if (!session) return <GuardSignIn onSignedIn={setS} />;
  return (
    <Shell
      session={session}
      onSignOut={async () => {
        await clearSession();
        setS(null);
      }}
    />
  );
}

/* ── sign in ────────────────────────────────────────────────────────────── */
function GuardSignIn({ onSignedIn }: { onSignedIn: (s: Session) => void }) {
  const sync = useSync();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void lastUsername().then((u) => u && setUsername(u));
    void probe();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const id = username.trim().toLowerCase();
    if (!id || !password) return setError('Enter your username and password');
    setBusy(true);
    setError(null);
    try {
      // Online first: the server is the only place a password is really checked.
      let user: User | null = null;
      let offline = false;
      try {
        const res = await request<{ token: string; user: User }>('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ username: id, password, surface: 'app' }),
          timeoutMs: 6000,
        });
        user = res.user;
        await rememberCredential(password, res.user, res.token);
        await requeueFor(res.user.id); // anything parked waiting for this guard's sign-in can go now
      } catch (err) {
        // A real "no" from the server is final — never fall back to the phone's copy.
        if (err instanceof ApiError) throw err;
        const cred = await verifyOffline(id, password);
        if (cred === 'unknown') throw new Error('No connection. The first sign-in on this phone needs internet — connect once, then you can sign in offline.');
        if (!cred) throw new Error('Wrong password (checked on this phone, offline)');
        user = cred.user;
        offline = true;
      }
      await setLastUsername(id);
      const s: Session = { user: user!, offline, at: Date.now() };
      await setSession(s);
      onSignedIn(s);
      void syncNow();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="signin">
      <form className="card signin-card" onSubmit={submit}>
        <Brand sub="Violation capture" />
        <div>
          <h1 className="signin-title">Guard sign in</h1>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            Works without internet after your first sign-in on this phone.
          </p>
        </div>
        <ConnBadge />
        <div className="field">
          <label htmlFor="u">Username</label>
          <input id="u" className="input" autoCapitalize="none" autoCorrect="off" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. guard1" />
        </div>
        <div className="field">
          <label htmlFor="p">Password</label>
          <div className="pw-wrap">
            <input id="p" className="input" type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" className="icon-btn" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'}>
              {show ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>
        {error && (
          <div className="form-error">
            <AlertTriangle size={16} style={{ flex: 'none', marginTop: 1 }} />
            <span>{error}</span>
          </div>
        )}
        <button className="btn btn-primary btn-lg btn-block" disabled={busy}>
          {busy ? <Loader2 size={18} className="spin" /> : <Lock size={18} />}
          {sync.online === false ? 'Sign in offline' : 'Sign in'}
        </button>
        <p className="signin-hint">Demo accounts: guard1 … guard4 · password Astrikos2026</p>
      </form>
    </div>
  );
}

/* ── connection badge ───────────────────────────────────────────────────── */
function ConnBadge({ compact = false }: { compact?: boolean }) {
  const s = useSync();
  if (s.syncing && s.progress)
    return (
      <span className="chip chip-info">
        <RefreshCw size={13} className="spin" /> Uploading {s.progress.done}/{s.progress.total}
      </span>
    );
  if (s.online === null)
    return (
      <span className="chip">
        <Loader2 size={13} className="spin" /> Checking…
      </span>
    );
  if (s.online)
    return (
      <span className="chip chip-success">
        <span className="dot dot-on" /> Online{!compact && s.pending ? ` · ${s.pending} to upload` : ''}
      </span>
    );
  return (
    <span className="chip chip-warning">
      <WifiOff size={13} /> Offline{s.pending ? ` · ${s.pending} saved` : ''}
    </span>
  );
}

/* ── shell ──────────────────────────────────────────────────────────────── */
function Shell({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>('home');
  const [capturing, setCapturing] = useState(false);
  const [open, setOpen] = useState<LocalRecord | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);
  const recs = useRecords();
  const sync = useSync();
  const sw = useSw();

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(t);
  }, [toast]);

  // Tell the guard when a batch finishes uploading — the moment the demo is about.
  const [seenSync, setSeenSync] = useState(sync.lastSyncAt);
  useEffect(() => {
    if (sync.lastSyncAt && sync.lastSyncAt !== seenSync) {
      setSeenSync(sync.lastSyncAt);
      setToast({ text: `${sync.lastSyncCount} violation${sync.lastSyncCount === 1 ? '' : 's'} uploaded to the control room`, tone: 'ok' });
    }
  }, [sync.lastSyncAt, sync.lastSyncCount, seenSync]);

  const onSaved = useCallback((online: boolean | null) => {
    setCapturing(false);
    setTab('home');
    setToast(online ? { text: 'Saved — uploading now', tone: 'ok' } : { text: 'Saved on this phone — will upload when online', tone: 'warn' });
    recordsChanged();
    void syncNow();
  }, []);

  if (capturing) return <CaptureFlow user={session.user} onCancel={() => setCapturing(false)} onSaved={onSaved} />;

  return (
    <div className="g-shell">
      <header className="g-header">
        <Brand sub={session.user.name} />
        <ConnBadge compact />
      </header>

      {sw.needRefresh && (
        <button className="g-banner g-banner-info" onClick={() => void updateSW?.(true)}>
          <RefreshCw size={16} /> A new version is ready — tap to update
        </button>
      )}

      <main className="g-main">
        {tab === 'home' && <HomeTab session={session} recs={recs} onRecord={() => setCapturing(true)} onOpen={setOpen} onAll={() => setTab('records')} />}
        {tab === 'records' && <RecordsTab recs={recs} onOpen={setOpen} />}
        {tab === 'settings' && <SettingsTab session={session} onSignOut={onSignOut} />}
      </main>

      <nav className="g-nav">
        <NavBtn icon={<Home size={20} />} label="Home" active={tab === 'home'} onClick={() => setTab('home')} />
        <button className="g-fab" onClick={() => setCapturing(true)} aria-label="Record violation">
          <Camera size={26} />
        </button>
        <NavBtn icon={<List size={20} />} label="Records" active={tab === 'records'} onClick={() => setTab('records')} badge={sync.pending || undefined} />
        <NavBtn icon={<Settings size={20} />} label="Settings" active={tab === 'settings'} onClick={() => setTab('settings')} />
      </nav>

      {open && <RecordSheet rec={recs.find((r) => r.id === open.id) ?? open} onClose={() => setOpen(null)} />}
      {toast && (
        <div className="toast" role="status">
          {toast.tone === 'ok' ? <CheckCircle2 size={18} color="var(--app-success)" /> : <Hourglass size={18} color="var(--app-warning)" />}
          {toast.text}
        </div>
      )}
    </div>
  );
}

function NavBtn({ icon, label, active, onClick, badge }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void; badge?: number }) {
  return (
    <button className={`g-nav-btn${active ? ' is-active' : ''}`} onClick={onClick}>
      <span className="g-nav-icon">
        {icon}
        {badge ? <span className="g-badge">{badge}</span> : null}
      </span>
      {label}
    </button>
  );
}

/* ── home ───────────────────────────────────────────────────────────────── */
function HomeTab({ session, recs, onRecord, onOpen, onAll }: { session: Session; recs: LocalRecord[]; onRecord: () => void; onOpen: (r: LocalRecord) => void; onAll: () => void }) {
  const s = useSync();
  const now = useNow();
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return recs.filter((r) => r.capturedAt >= d.getTime() && r.guardId === session.user.id).length;
  }, [recs, session.user.id]);

  return (
    <>
      <InstallHint />
      <section className={`card g-status ${s.online ? 'is-online' : s.online === false ? 'is-offline' : ''}`}>
        <div className="g-status-icon">{s.syncing ? <UploadCloud size={22} /> : s.online ? <CheckCircle2 size={22} /> : s.online === false ? <WifiOff size={22} /> : <Loader2 size={22} className="spin" />}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="g-status-title">
            {s.syncing ? 'Uploading to the control room…' : s.online ? (s.pending ? 'Connected — uploading' : 'Connected — all uploaded') : s.online === false ? 'No connection — working offline' : 'Checking connection…'}
          </div>
          <div className="g-status-sub">
            {s.online === false
              ? 'Keep recording. Everything is saved on this phone and uploads by itself when the connection is back.'
              : s.lastSyncAt
                ? `Last upload ${ago(s.lastSyncAt, now)}`
                : 'Violations upload as soon as they are saved.'}
          </div>
        </div>
        <button className="icon-btn" onClick={() => void syncNow()} aria-label="Sync now" disabled={s.syncing}>
          <RefreshCw size={18} className={s.syncing ? 'spin' : ''} />
        </button>
      </section>

      {session.offline && s.online === false && (
        <div className="g-banner g-banner-warn">
          <Info size={16} /> Signed in offline. Your records are saved here and will upload with your account when online.
        </div>
      )}
      {s.needsSignIn.length > 0 && (
        <div className="g-banner g-banner-warn">
          <AlertTriangle size={16} /> Some records need an online sign-in by {s.needsSignIn.join(', ')} before they can upload.
        </div>
      )}

      <div className="g-tiles">
        <div className="card g-tile">
          <div className="kpi-value">{s.pending}</div>
          <div className="g-tile-label">Saved on phone, waiting to upload</div>
        </div>
        <div className="card g-tile">
          <div className="kpi-value">{today}</div>
          <div className="g-tile-label">Recorded by you today</div>
        </div>
      </div>

      <button className="btn btn-primary btn-lg btn-block g-record" onClick={onRecord}>
        <Camera size={22} /> Record a violation
      </button>

      <section>
        <div className="g-section-head">
          <h3>Recent</h3>
          {recs.length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={onAll}>
              All records <ChevronRight size={14} />
            </button>
          )}
        </div>
        {recs.length === 0 ? <Empty /> : <RecordList recs={recs.slice(0, 5)} onOpen={onOpen} />}
      </section>
    </>
  );
}

function InstallHint() {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem('pp.installHint') === 'hidden';
    } catch {
      return false;
    }
  });
  if (isStandalone() || hidden) return null;
  const hide = () => {
    setHidden(true);
    try {
      localStorage.setItem('pp.installHint', 'hidden');
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="card g-install">
      <Smartphone size={20} style={{ flex: 'none' }} />
      <div style={{ flex: 1 }}>
        <strong>Install for offline use</strong>
        <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
          {isIOS() ? (
            <>
              In Safari tap <Share size={13} style={{ verticalAlign: '-2px' }} /> Share, then <b>Add to Home Screen</b>
              <PlusSquare size={13} style={{ verticalAlign: '-2px', marginLeft: 4 }} />. Open it from the icon and sign in once while online.
            </>
          ) : (
            <>
              In Chrome open the ⋮ menu and tap <b>Install app</b> (or <b>Add to Home screen</b>). Open it from the icon.
            </>
          )}
        </div>
      </div>
      <button className="icon-btn" onClick={hide} aria-label="Dismiss">
        <X size={16} />
      </button>
    </div>
  );
}

function Empty() {
  return (
    <div className="card g-empty">
      <Camera size={28} />
      <div>No violations recorded on this phone yet.</div>
    </div>
  );
}

/* ── records ────────────────────────────────────────────────────────────── */
function RecordsTab({ recs, onOpen }: { recs: LocalRecord[]; onOpen: (r: LocalRecord) => void }) {
  const waiting = recs.filter((r) => r.syncState !== 'synced');
  const done = recs.filter((r) => r.syncState === 'synced');
  return (
    <>
      <div className="g-section-head">
        <h3>On this phone</h3>
        <span className="faint" style={{ fontSize: 12 }}>
          Uploaded records stay here for 7 days
        </span>
      </div>
      {recs.length === 0 && <Empty />}
      {waiting.length > 0 && (
        <>
          <div className="eyebrow" style={{ margin: '4px 2px 8px' }}>
            Waiting to upload · {waiting.length}
          </div>
          <RecordList recs={waiting} onOpen={onOpen} />
        </>
      )}
      {done.length > 0 && (
        <>
          <div className="eyebrow" style={{ margin: '16px 2px 8px' }}>
            Uploaded · {done.length}
          </div>
          <RecordList recs={done} onOpen={onOpen} />
        </>
      )}
    </>
  );
}

export function SyncChip({ r }: { r: LocalRecord }) {
  switch (r.syncState) {
    case 'synced':
      return (
        <span className="chip chip-success">
          <CheckCircle2 size={12} /> Uploaded
        </span>
      );
    case 'syncing':
      return (
        <span className="chip chip-info">
          <RefreshCw size={12} className="spin" /> Uploading
        </span>
      );
    case 'rejected':
      return (
        <span className="chip chip-danger">
          <AlertTriangle size={12} /> Needs fixing
        </span>
      );
    case 'auth':
      return (
        <span className="chip chip-warning">
          <UserIcon size={12} /> Sign-in needed
        </span>
      );
    default:
      return (
        <span className="chip chip-warning">
          <Hourglass size={12} /> Saved on phone
        </span>
      );
  }
}

function RecordList({ recs, onOpen }: { recs: LocalRecord[]; onOpen: (r: LocalRecord) => void }) {
  return (
    <div className="card g-list">
      {recs.map((r) => (
        <button key={r.id} className="g-row" onClick={() => onOpen(r)}>
          <div className="g-thumb">{r.thumb ? <img src={r.thumb} alt="" /> : <TypeIcon icon={typeOf(r.type)?.icon} size={20} />}</div>
          <div className="g-row-main">
            <div className="g-row-top">
              <PlateChip plate={r.plate} />
              <span className="g-row-type">{typeOf(r.type)?.short ?? r.type}</span>
            </div>
            <div className="g-row-sub">
              {fmtTime(r.capturedAt)} · {areaOf(r.location.areaId)?.label ?? (r.location.gps ? 'GPS only' : 'No location')}
            </div>
          </div>
          <SyncChip r={r} />
        </button>
      ))}
    </div>
  );
}

function RecordSheet({ rec, onClose }: { rec: LocalRecord; onClose: () => void }) {
  const [photos, setPhotos] = useState<{ kind: string; url: string }[]>([]);
  useEffect(() => {
    let urls: string[] = [];
    void photosFor(rec.id).then((ps) => {
      urls = ps.map((p) => URL.createObjectURL(new Blob([p.buf], { type: p.type })));
      setPhotos(ps.map((p, i) => ({ kind: p.kind, url: urls[i] })));
    });
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [rec.id, rec.syncState]);
  const t = typeOf(rec.type);
  return (
    <div className="g-sheet-wrap" onClick={onClose}>
      <div className="g-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Violation details">
        <div className="g-sheet-head">
          <div>
            <div className="eyebrow">{rec.ref}</div>
            <h3 style={{ marginTop: 4 }}>{t?.label ?? rec.type}</h3>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <div className="g-sheet-body">
          <div className="g-photos">
            {photos.length > 0
              ? photos.map((p) => (
                  <figure key={p.kind}>
                    <img src={p.url} alt={p.kind} />
                    <figcaption>{p.kind === 'vehicle' ? 'Vehicle' : 'Plate close-up'}</figcaption>
                  </figure>
                ))
              : rec.thumb && (
                  <figure>
                    <img src={rec.thumb} alt="" />
                    <figcaption>{rec.syncState === 'synced' ? 'Full photos are on the server' : 'Photo'}</figcaption>
                  </figure>
                )}
          </div>
          <dl className="g-dl">
            <dt>Plate</dt>
            <dd>
              <PlateChip plate={rec.plate} /> <span className="faint">{rec.plate.source === 'ocr' ? 'read by plate reader, confirmed' : 'typed'}</span>
            </dd>
            <dt>Status</dt>
            <dd>
              <SyncChip r={rec} />
              {rec.lastError && rec.syncState !== 'synced' && <div className="faint" style={{ marginTop: 4 }}>{rec.lastError}</div>}
            </dd>
            <dt>Captured</dt>
            <dd>
              {fmtDateTime(rec.capturedAt)} {rec.capturedOffline && <span className="chip chip-warning">offline</span>}
            </dd>
            {rec.syncedAt && (
              <>
                <dt>Uploaded</dt>
                <dd>{fmtDateTime(rec.syncedAt)}</dd>
              </>
            )}
            <dt>Location</dt>
            <dd>
              {areaOf(rec.location.areaId)?.label ?? '—'}
              {rec.location.landmark && ` · ${rec.location.landmark}`}
              {rec.location.gps && (
                <div className="faint mono">
                  {rec.location.gps.lat.toFixed(5)}, {rec.location.gps.lng.toFixed(5)} (±{Math.round(rec.location.gps.accuracy ?? 0)} m)
                </div>
              )}
            </dd>
            {rec.notes && (
              <>
                <dt>Notes</dt>
                <dd>{rec.notes}</dd>
              </>
            )}
            <dt>Guard</dt>
            <dd>
              {rec.guardName} · {rec.deviceLabel}
            </dd>
          </dl>
          <div className="g-sheet-actions">
            {rec.syncState === 'rejected' && (
              <button className="btn" onClick={() => void retryRecord(rec.id)}>
                <RotateCcw size={16} /> Try upload again
              </button>
            )}
            {rec.syncState !== 'synced' && (
              <button
                className="btn btn-danger"
                onClick={async () => {
                  await deleteUnsynced(rec.id);
                  recordsChanged();
                  onClose();
                }}
              >
                <Trash2 size={16} /> Delete from phone
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── settings ───────────────────────────────────────────────────────────── */
function SettingsTab({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const s = useSync();
  const sw = useSw();
  const [dev, setDev] = useState<{ deviceId: string; name: string } | null>(null);
  const [name, setName] = useState('');
  const [persisted, setPersisted] = useState<boolean | null>(null);
  useEffect(() => {
    void deviceInfo().then((d) => {
      setDev(d);
      setName(d.name);
    });
    void navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
  }, []);
  return (
    <>
      <section className="card card-pad g-settings">
        <div className="g-section-head" style={{ marginTop: 0 }}>
          <h3>Signed in</h3>
          {session.offline ? <span className="chip chip-warning">offline sign-in</span> : <span className="chip chip-success">verified online</span>}
        </div>
        <div style={{ fontWeight: 700 }}>{session.user.name}</div>
        <div className="muted">
          {session.user.id} · {areaOf(session.user.area)?.label ?? 'All areas'}
        </div>
        <button className="btn btn-block" style={{ marginTop: 14 }} onClick={onSignOut}>
          <LogOut size={16} /> Sign out
        </button>
        <p className="faint" style={{ fontSize: 12, margin: '8px 0 0' }}>
          Signing out keeps unsent records on the phone; they still upload for the guard who recorded them.
        </p>
      </section>

      <section className="card card-pad g-settings">
        <h3 style={{ marginBottom: 12 }}>This device</h3>
        <div className="field">
          <label htmlFor="dn">Device name (shown on the dashboard)</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input id="dn" className="input" value={name} placeholder={platformLabel().label} onChange={(e) => setName(e.target.value)} />
            <button
              className="btn"
              onClick={async () => {
                await renameDevice(name);
                await connectSocket();
              }}
            >
              Save
            </button>
          </div>
        </div>
        <dl className="g-dl" style={{ marginTop: 14 }}>
          <dt>Device id</dt>
          <dd className="mono">{dev?.deviceId.slice(0, 8)}…</dd>
          <dt>Server</dt>
          <dd>{s.online ? 'Reachable' : s.online === false ? 'Not reachable' : 'Checking'}{s.socket ? ' · live' : ''}</dd>
          <dt>Offline mode</dt>
          <dd>{sw.offlineReady ? 'Ready — the app opens without internet' : 'Not ready yet (open once online over https)'}</dd>
          <dt>Installed</dt>
          <dd>{isStandalone() ? 'Yes (Home Screen app)' : 'No — running in the browser'}</dd>
          <dt>Storage</dt>
          <dd>{persisted ? 'Protected from clean-up' : persisted === false ? 'Standard' : 'Unknown'}</dd>
          <dt>Version</dt>
          <dd>{APP_VERSION}</dd>
        </dl>
      </section>
    </>
  );
}
