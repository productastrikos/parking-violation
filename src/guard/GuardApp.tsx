/**
 * The guard app — what a security guard uses on patrol. Installable to the
 * Home Screen (Android and iPhone) and fully usable with no network:
 *
 *   sign in (offline after the first time) → scan & record a violation → it is
 *   saved on the phone at once → it uploads by itself when back online.
 *
 * Tabs: Home · Records · (record) · Patrol (AI outlook, hotspots, plate
 * watchlist — cached, works offline) · Settings (GPS demo/real, theme, device).
 *
 * State lives in IndexedDB (offline/db.ts); this file is screens only. The
 * connection badge is the honest one from the sync engine: green means OUR
 * server answered, not merely that Wi-Fi is on. The look is a deliberate
 * "material" layer (guard.css): textured ground, lit surfaces, pressable
 * controls — it should feel like an installed app, not a web page.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  AlertTriangle, Camera, CheckCircle2, ChevronRight, Eye, EyeOff, Home, List, Loader2, Lock, LogOut, PlusSquare, RefreshCw, Settings, Share, Smartphone, Trash2,
  User as UserIcon, WifiOff, X, RotateCcw, UploadCloud, Hourglass, Info, Pencil, Flag, Sparkles, TrendingUp, TrendingDown, Siren, Search, FlaskConical, Crosshair, Moon, Sun, Ban, Gavel, Clock, Printer,
} from 'lucide-react';
import { registerSW } from 'virtual:pwa-register';
import { watchVersion } from '../lib/version';
import { request, ApiError, APP_VERSION, typeOf, areaOf, fmtDateTime, fmtTime, ago, statusLabel, type User } from '../lib/api';
import { ClientLogo, PlateChip, PoweredBy, TypeIcon, useNow, useTheme, applyTheme } from '../lib/ui';
import { allRecords, deleteUnsynced, photosFor, pruneSynced, queueOp, type LocalRecord } from './offline/db';
import { getSession, setSession, clearSession, verifyOffline, rememberCredential, lastUsername, setLastUsername, type Session } from './offline/offlineAuth';
import { deviceInfo, renameDevice, platformLabel, isIOS, isStandalone, requestPersistence, uuid } from './offline/device';
import {
  getStatus, subscribe, syncNow, startSyncEngine, connectSocket, disconnectSocket, onRecordsChanged, requeueFor, retryRecord, probe, recordsChanged, getFieldPack, subscribePack, refreshFieldPack,
} from './offline/sync';
import { useGpsMode, setGpsMode, wasAutoSwitched } from './offline/location';
import { warmUpOcr } from './offline/plateOcr';
import CaptureFlow from './CaptureFlow';
import { Confirm, AskReason } from './Sheet';
import { PrintSheet, PrinterSettingsSection, FineScheduleSection } from './PrintNotice';
import { getPrinter } from './print/printer';
import './guard.css';

type Tab = 'home' | 'records' | 'patrol' | 'settings';

const useSync = () => useSyncExternalStore(subscribe, getStatus);

/** Forecasts are rates; a guard reads whole numbers. */
const approx = (n: number) => (n < 0.95 ? '<1' : `~${Math.round(n)}`);
const expectText = (n: number) => (n < 0.95 ? 'Fewer than 1 violation' : `About ${Math.round(n)} violation${Math.round(n) === 1 ? '' : 's'}`);
const usePack = () => useSyncExternalStore(subscribePack, getFieldPack);

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
/*
 * Updates: a new version is looked for on open, every 10 minutes, whenever the
 * app comes back to the foreground, and when /version.json says the server has
 * a new build. It installs in the background and is APPLIED AUTOMATICALLY while
 * no violation form is open (a form in progress is never reloaded; it applies
 * when the guard leaves the form). The banner remains as a manual fallback.
 */
let captureOpen = false;
let swReg: ServiceWorkerRegistration | null = null;
let reloading = false;
/** Activate the waiting version and reload onto it. The plugin's own reload hook does not always
 *  fire (seen in Chrome: new worker active, page still on the old build), so reload on the
 *  browser's controllerchange, with a timed fallback. */
function applyUpdateNow() {
  if (reloading) return;
  reloading = true;
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
  void updateSW?.(true);
  window.setTimeout(() => window.location.reload(), 4000);
}
function applyUpdateIfIdle() {
  if (swState.needRefresh && !captureOpen) applyUpdateNow();
}
export function setCaptureOpen(open: boolean) {
  captureOpen = open;
  if (!open) applyUpdateIfIdle();
}
const checkForUpdate = () => {
  if (navigator.onLine) void swReg?.update().catch(() => {});
};
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh: () => {
      setSw({ needRefresh: true });
      applyUpdateIfIdle();
    },
    onOfflineReady: () => setSw({ offlineReady: true }),
    onRegisteredSW: (_url, reg) => {
      if (!reg) return;
      swReg = reg;
      window.setInterval(checkForUpdate, 10 * 60 * 1000);
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && checkForUpdate());
    },
  });
  if (navigator.serviceWorker.controller) swState.offlineReady = true;
  watchVersion(checkForUpdate, 5 * 60 * 1000);
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
  const [splash, setSplash] = useState(true);

  useEffect(() => {
    void getSession().then((s) => setS(s ?? null));
    void deviceInfo();
    void requestPersistence();
    void pruneSynced();
    startSyncEngine();
    const t = setTimeout(() => setSplash(false), 650);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (session) {
      void connectSocket();
      warmUpOcr();
      void refreshFieldPack(true);
    } else disconnectSocket();
  }, [session]);

  if (session === undefined || splash) return <Splash />;
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

function Splash() {
  return (
    <div className="g-splash m-shell">
      <img src="/brand/astrikos-solo.png" alt="" />
      <div className="g-splash-name">Park Patrol</div>
      <div className="g-splash-sub">Violation capture · works offline</div>
    </div>
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
        const res = await request<{ token: string; user: User }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: id, password, surface: 'app' }), timeoutMs: 6000 });
        user = res.user;
        await rememberCredential(password, res.user, res.token);
        await requeueFor(res.user.id);
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
      navigator.vibrate?.(25);
      onSignedIn(s);
      void syncNow();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="g-signin m-shell">
      <form className="n-card g-signin-card" onSubmit={submit}>
        <ClientLogo />
        <div className="g-signin-brand">
          <img src="/brand/astrikos-solo.png" alt="" />
          <div>
            <div className="g-signin-name">Park Patrol</div>
            <div className="faint" style={{ fontSize: 12 }}>
              Parking & traffic enforcement
            </div>
          </div>
        </div>
        <ConnBadge />
        <div className="field">
          <label htmlFor="u">Username</label>
          <div className="n-input-wrap">
            <UserIcon size={17} />
            <input id="u" className="input" autoCapitalize="none" autoCorrect="off" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. guard1" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="p">Password</label>
          <div className="n-input-wrap">
            <Lock size={17} />
            <input id="p" className="input" type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" className="icon-btn" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'}>
              {show ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>
        {error && (
          <div className="form-error" role="alert">
            <AlertTriangle size={16} style={{ flex: 'none', marginTop: 1 }} />
            <span>{error}</span>
          </div>
        )}
        <button className="btn btn-primary btn-lg btn-block n-primary" disabled={busy}>
          {busy ? <Loader2 size={18} className="spin" /> : <Lock size={18} />}
          {sync.online === false ? 'Sign in offline' : 'Sign in'}
        </button>
        <p className="signin-hint">Works without internet after your first sign-in on this phone. Demo: guard1 … guard4 · Astrikos2026</p>
        <PoweredBy />
      </form>
    </div>
  );
}

/* ── connection badge ───────────────────────────────────────────────────── */
function ConnBadge({ compact = false }: { compact?: boolean }) {
  const s = useSync();
  if (s.syncing && s.progress)
    return (
      <span className="chip chip-info n-chip">
        <RefreshCw size={13} className="spin" /> Uploading {s.progress.done}/{s.progress.total}
      </span>
    );
  if (s.online === null)
    return (
      <span className="chip n-chip">
        <Loader2 size={13} className="spin" /> Checking…
      </span>
    );
  if (s.online)
    return (
      <span className="chip chip-success n-chip">
        <span className="dot dot-on" /> Online{!compact && s.pending ? ` · ${s.pending} to upload` : ''}
      </span>
    );
  return (
    <span className="chip chip-warning n-chip">
      <WifiOff size={13} /> Offline{s.pending ? ` · ${s.pending} saved` : ''}
    </span>
  );
}

/* ── shell ──────────────────────────────────────────────────────────────── */
function Shell({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>('home');
  const [capturing, setCapturing] = useState<{ editing?: LocalRecord | null } | null>(null);
  useEffect(() => setCaptureOpen(Boolean(capturing)), [capturing]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [printId, setPrintId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);
  const recs = useRecords();
  const sync = useSync();
  const sw = useSw();
  const gpsMode = useGpsMode();

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
      navigator.vibrate?.(30);
    }
  }, [sync.lastSyncAt, sync.lastSyncCount, seenSync]);

  const onSaved = useCallback((online: boolean | null, edited: boolean, id?: string) => {
    setCapturing(null);
    setTab('home');
    // Hand the fine over on the spot: the print screen opens for the new violation.
    if (id && !edited && getPrinter().offerAfterSave) setPrintId(id);
    setToast(edited ? { text: 'Changes saved — will upload with the record', tone: 'ok' } : online ? { text: 'Saved — uploading now', tone: 'ok' } : { text: 'Saved on this phone — will upload when online', tone: 'warn' });
    recordsChanged();
    void syncNow();
  }, []);

  if (capturing) return <CaptureFlow user={session.user} editing={capturing.editing} onCancel={() => setCapturing(null)} onSaved={onSaved} />;

  const open = openId ? recs.find((r) => r.id === openId) ?? null : null;
  const printing = printId ? recs.find((r) => r.id === printId) ?? null : null;

  return (
    <div className="g-shell m-shell">
      <header className="g-header">
        <div className="g-avatar" aria-hidden>
          {session.user.name
            .split(' ')
            .map((p) => p[0])
            .slice(0, 2)
            .join('')}
        </div>
        <div className="g-header-who">
          <div className="g-header-name">{session.user.name}</div>
          <div className="g-header-sub">
            {areaOf(session.user.area)?.label ?? 'All areas'}
            {gpsMode === 'demo' && <span className="g-demo-tag">DEMO GPS</span>}
          </div>
        </div>
        <ConnBadge compact />
      </header>

      {sw.needRefresh && (
        <button className="g-banner g-banner-info" onClick={applyUpdateNow}>
          <RefreshCw size={16} /> A new version is ready — tap to update
        </button>
      )}

      <main className="g-main" key={tab}>
        {tab === 'home' && <HomeTab session={session} recs={recs} onRecord={() => setCapturing({})} onOpen={(r) => setOpenId(r.id)} onAll={() => setTab('records')} onPatrol={() => setTab('patrol')} />}
        {tab === 'records' && <RecordsTab recs={recs} onOpen={(r) => setOpenId(r.id)} />}
        {tab === 'patrol' && <PatrolTab session={session} />}
        {tab === 'settings' && <SettingsTab session={session} onSignOut={onSignOut} />}
      </main>

      <nav className="g-nav" aria-label="Main">
        <NavBtn icon={<Home size={21} />} label="Home" active={tab === 'home'} onClick={() => setTab('home')} />
        <NavBtn icon={<List size={21} />} label="Records" active={tab === 'records'} onClick={() => setTab('records')} badge={sync.pending || undefined} />
        <div className="g-fab-slot">
          <button className="g-fab" onClick={() => setCapturing({})} aria-label="Record a violation">
            <Camera size={26} />
          </button>
        </div>
        <NavBtn icon={<Sparkles size={21} />} label="Patrol" active={tab === 'patrol'} onClick={() => setTab('patrol')} />
        <NavBtn icon={<Settings size={21} />} label="Settings" active={tab === 'settings'} onClick={() => setTab('settings')} />
      </nav>

      {open && (
        <RecordSheet
          rec={open}
          onClose={() => setOpenId(null)}
          onEdit={() => {
            setOpenId(null);
            setCapturing({ editing: open });
          }}
          onToast={setToast}
          onPrint={() => {
            setOpenId(null);
            setPrintId(open.id);
          }}
        />
      )}
      {printing && (
        <PrintSheet
          rec={printing}
          onClose={() => setPrintId(null)}
          onSettings={() => {
            setPrintId(null);
            setTab('settings');
          }}
          onDone={(text) => {
            setPrintId(null);
            setToast({ text, tone: 'ok' });
          }}
        />
      )}
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
    <button className={`g-nav-btn${active ? ' is-active' : ''}`} onClick={onClick} aria-current={active ? 'page' : undefined}>
      <span className="g-nav-icon">
        {icon}
        {badge ? <span className="g-badge">{badge}</span> : null}
      </span>
      {label}
    </button>
  );
}

/* ── home ───────────────────────────────────────────────────────────────── */
function HomeTab({ session, recs, onRecord, onOpen, onAll, onPatrol }: { session: Session; recs: LocalRecord[]; onRecord: () => void; onOpen: (r: LocalRecord) => void; onAll: () => void; onPatrol: () => void }) {
  const s = useSync();
  const pack = usePack();
  const now = useNow();
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return recs.filter((r) => r.capturedAt >= d.getTime() && r.guardId === session.user.id).length;
  }, [recs, session.user.id]);
  const outlook = pack?.outlook;

  return (
    <>
      <InstallHint />
      <section className={`n-card g-status ${s.online ? 'is-online' : s.online === false ? 'is-offline' : ''}`}>
        <div className="g-status-icon">{s.syncing ? <UploadCloud size={22} /> : s.online ? <CheckCircle2 size={22} /> : s.online === false ? <WifiOff size={22} /> : <Loader2 size={22} className="spin" />}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="g-status-title">
            {s.syncing ? 'Uploading to the control room…' : s.online ? (s.pending ? 'Connected — uploading' : 'Connected — all uploaded') : s.online === false ? 'No connection — working offline' : 'Checking connection…'}
          </div>
          <div className="g-status-sub">
            {s.online === false ? 'Keep recording. Everything is saved on this phone and uploads by itself when the connection is back.' : s.lastSyncAt ? `Last upload ${ago(s.lastSyncAt, now)}` : 'Violations upload as soon as they are saved.'}
          </div>
        </div>
        <button className="n-round" onClick={() => void syncNow()} aria-label="Sync now" disabled={s.syncing}>
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
      {s.rejected > 0 && (
        <div className="g-banner g-banner-danger">
          <AlertTriangle size={16} /> {s.rejected} record{s.rejected > 1 ? 's' : ''} need fixing before upload — open Records.
        </div>
      )}

      <div className="g-tiles">
        <div className="n-card g-tile">
          <div className="kpi-value">{s.pending}</div>
          <div className="g-tile-label">Saved on phone, waiting to upload</div>
        </div>
        <div className="n-card g-tile">
          <div className="kpi-value">{today}</div>
          <div className="g-tile-label">Recorded by you today</div>
        </div>
      </div>

      <button className="btn btn-primary btn-lg btn-block g-record n-primary" onClick={onRecord}>
        <Camera size={22} /> Record a violation
      </button>

      {outlook && (
        <button className="n-card g-ai-card" onClick={onPatrol}>
          <div className="g-ai-head">
            <span className="g-ai-brand">
              <Sparkles size={14} /> AI patrol outlook
            </span>
            <ChevronRight size={16} className="faint" />
          </div>
          <div className="g-ai-title">
            {expectText(outlook.next3)} expected in {outlook.label.replace(/ \(.*\)$/, '')} in the next 3 h
          </div>
          <div className="g-ai-sub">
            Peak around {String(outlook.peakHour).padStart(2, '0')}:00 · usually {outlook.topTypes.map((t) => t.label.toLowerCase()).join(', ') || 'mixed'} · {outlook.trendPct >= 0 ? '+' : ''}
            {outlook.trendPct}% vs last week
          </div>
        </button>
      )}

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
    <div className="n-card g-install">
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

function Empty({ text = 'No violations recorded on this phone yet.' }: { text?: string }) {
  return (
    <div className="n-card g-empty">
      <Camera size={28} />
      <div>{text}</div>
    </div>
  );
}

/* ── records ────────────────────────────────────────────────────────────── */
type RecFilter = 'all' | 'waiting' | 'uploaded' | 'attention';
function RecordsTab({ recs, onOpen }: { recs: LocalRecord[]; onOpen: (r: LocalRecord) => void }) {
  const [filter, setFilter] = useState<RecFilter>('all');
  const [q, setQ] = useState('');
  const attention = (r: LocalRecord) => r.syncState === 'rejected' || r.syncState === 'auth' || Boolean(r.server?.voided) || r.server?.correction?.state === 'pending' || Boolean(r.correctionQueued);
  const list = recs.filter((r) => {
    if (q && !`${r.plate.code}${r.plate.number} ${r.ref} ${typeOf(r.type)?.short}`.toLowerCase().includes(q.toLowerCase().replace(/\s+/g, ''))) return false;
    if (filter === 'waiting') return r.syncState !== 'synced';
    if (filter === 'uploaded') return r.syncState === 'synced';
    if (filter === 'attention') return attention(r);
    return true;
  });
  const counts = { all: recs.length, waiting: recs.filter((r) => r.syncState !== 'synced').length, uploaded: recs.filter((r) => r.syncState === 'synced').length, attention: recs.filter(attention).length };
  return (
    <>
      <div className="n-search">
        <Search size={16} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search plate or reference" aria-label="Search records" />
      </div>
      <div className="n-segment" role="tablist">
        {(['all', 'waiting', 'uploaded', 'attention'] as RecFilter[]).map((f) => (
          <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? 'is-on' : ''} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : f === 'waiting' ? 'To upload' : f === 'uploaded' ? 'Uploaded' : 'Attention'}
            <span className="n-seg-count">{counts[f]}</span>
          </button>
        ))}
      </div>
      {list.length === 0 ? <Empty text={recs.length ? 'Nothing matches.' : undefined} /> : <RecordList recs={list} onOpen={onOpen} />}
      <p className="faint" style={{ fontSize: 12, textAlign: 'center', margin: '10px 0 0' }}>
        Uploaded records stay on this phone for 7 days; the control room keeps them all.
      </p>
    </>
  );
}

export function SyncChip({ r }: { r: LocalRecord }) {
  if (r.server?.voided)
    return (
      <span className="chip chip-danger">
        <Ban size={12} /> Voided
      </span>
    );
  if (r.correctionQueued || r.server?.correction?.state === 'pending')
    return (
      <span className="chip chip-warning">
        <Flag size={12} /> Mistake reported
      </span>
    );
  switch (r.syncState) {
    case 'synced':
      if (r.server?.status === 'actioned')
        return (
          <span className="chip chip-success">
            <Gavel size={12} /> Fine issued
          </span>
        );
      if (r.server?.status === 'dismissed') return <span className="chip">Dismissed</span>;
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
          <Hourglass size={12} /> On phone
        </span>
      );
  }
}

function RecordList({ recs, onOpen }: { recs: LocalRecord[]; onOpen: (r: LocalRecord) => void }) {
  return (
    <div className="n-card n-list">
      {recs.map((r) => (
        <button key={r.id} className="g-row" onClick={() => onOpen(r)}>
          <div className="g-thumb">{r.thumb ? <img src={r.thumb} alt="" /> : <TypeIcon icon={typeOf(r.type)?.icon} size={20} />}</div>
          <div className="g-row-main">
            <div className="g-row-top">
              <PlateChip plate={r.server?.plate ?? r.plate} />
              <span className="g-row-type">{typeOf(r.server?.type ?? r.type)?.short ?? r.type}</span>
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

function RecordSheet({ rec, onClose, onEdit, onToast, onPrint }: { rec: LocalRecord; onClose: () => void; onEdit: () => void; onToast: (t: { text: string; tone: 'ok' | 'warn' }) => void; onPrint: () => void }) {
  const [photos, setPhotos] = useState<{ kind: string; url: string }[]>([]);
  const [ask, setAsk] = useState<'delete' | 'mistake' | null>(null);
  useEffect(() => {
    let urls: string[] = [];
    void photosFor(rec.id).then((ps) => {
      urls = ps.map((p) => URL.createObjectURL(new Blob([p.buf], { type: p.type })));
      setPhotos(ps.map((p, i) => ({ kind: p.kind, url: urls[i] })));
    });
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [rec.id, rec.syncState]);
  const t = typeOf(rec.server?.type ?? rec.type);
  const plate = rec.server?.plate ?? rec.plate;
  const synced = rec.syncState === 'synced';
  const canEdit = !synced && rec.syncState !== 'syncing';
  const canReport = synced && !rec.server?.voided && !rec.correctionQueued && rec.server?.correction?.state !== 'pending';

  async function reportMistake(reason: string) {
    await queueOp({ id: uuid(), kind: 'correction', violationId: rec.id, guardId: rec.guardId, reason, createdAt: Date.now(), state: 'pending' });
    recordsChanged();
    void syncNow();
    setAsk(null);
    onToast({ text: getStatus().online ? 'Mistake reported to the control room' : 'Mistake report saved — sends when online', tone: 'ok' });
  }

  return (
    <div className="g-sheet-wrap" onClick={onClose}>
      <div className="g-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Violation details">
        <div className="g-sheet-grip" />
        <div className="g-sheet-head">
          <div>
            <div className="eyebrow mono">{rec.ref}</div>
            <h3 style={{ marginTop: 4 }}>{t?.label ?? rec.type}</h3>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <div className="g-sheet-body">
          {rec.server?.voided && (
            <div className="g-note g-note-danger">
              <Ban size={15} /> Voided by the control room{rec.server.voidReason ? `: "${rec.server.voidReason}"` : ''}. It will not lead to a fine.
            </div>
          )}
          {rec.server?.edited && !rec.server.voided && (
            <div className="g-note g-note-info">
              <Pencil size={15} /> Corrected by the control room — showing their version.
            </div>
          )}
          {(rec.correctionQueued || rec.server?.correction?.state === 'pending') && (
            <div className="g-note g-note-warn">
              <Flag size={15} /> Mistake reported{rec.correctionQueued ? ' (sends when online)' : ''} — the control room will review it.
            </div>
          )}
          {rec.server?.correction?.state === 'dismissed' && (
            <div className="g-note g-note-info">
              <Info size={15} /> Your mistake report was reviewed; the record was kept.
            </div>
          )}

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
                    <figcaption>{synced ? 'Full photos are on the server' : 'Photo'}</figcaption>
                  </figure>
                )}
          </div>
          <dl className="g-dl">
            <dt>Plate</dt>
            <dd>
              <PlateChip plate={plate} /> <span className="faint">{plate.source === 'ocr' ? 'read by plate reader, confirmed' : 'typed'}</span>
            </dd>
            <dt>Status</dt>
            <dd>
              <SyncChip r={rec} /> {synced && rec.server && !rec.server.voided && <span className="faint">· {statusLabel(rec.server.status)}</span>}
              {rec.lastError && !synced && <div className="faint" style={{ marginTop: 4 }}>{rec.lastError}</div>}
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
                  {rec.location.gps.lat.toFixed(5)}, {rec.location.gps.lng.toFixed(5)} (±{Math.round(rec.location.gps.accuracy ?? 0)} m){rec.location.gps.demo ? ' · demo' : ''}
                </div>
              )}
            </dd>
            {rec.notes && (
              <>
                <dt>Notes</dt>
                <dd>{rec.notes}</dd>
              </>
            )}
            {rec.printCount ? (
              <>
                <dt>Notice</dt>
                <dd>
                  Printed {rec.printCount}× · last {fmtDateTime(rec.printedAt)}
                </dd>
              </>
            ) : null}
            <dt>Guard</dt>
            <dd>
              {rec.guardName} · {rec.deviceLabel}
            </dd>
          </dl>
          {!rec.server?.voided && (
            <button className="btn btn-primary btn-lg btn-block n-primary" onClick={onPrint}>
              <Printer size={18} /> {rec.printCount ? 'Reprint penalty notice' : 'Print penalty notice'}
            </button>
          )}
          <div className="g-sheet-actions">
            {canEdit && (
              <button className="btn btn-lg" onClick={onEdit}>
                <Pencil size={16} /> Edit
              </button>
            )}
            {rec.syncState === 'rejected' && (
              <button className="btn btn-lg" onClick={() => void retryRecord(rec.id)}>
                <RotateCcw size={16} /> Upload again
              </button>
            )}
            {canEdit && (
              <button className="btn btn-lg btn-danger" onClick={() => setAsk('delete')}>
                <Trash2 size={16} /> Delete
              </button>
            )}
            {canReport && (
              <button className="btn btn-lg" onClick={() => setAsk('mistake')}>
                <Flag size={16} /> Report a mistake
              </button>
            )}
          </div>
        </div>
      </div>
      {ask === 'delete' && (
        <Confirm
          title="Delete this violation?"
          body="It has not been uploaded, so it will be gone for good. Use Edit instead if only a detail is wrong."
          confirm="Delete"
          danger
          onCancel={() => setAsk(null)}
          onConfirm={async () => {
            await deleteUnsynced(rec.id);
            recordsChanged();
            onClose();
          }}
        />
      )}
      {ask === 'mistake' && (
        <AskReason
          title="Report a mistake"
          body="This record is already with the control room. Tell them what is wrong — a supervisor will correct or void it. Works offline."
          placeholder="What is wrong?"
          confirm="Send report"
          quick={['Wrong plate number', 'Wrong vehicle', 'Wrong violation type', 'Recorded twice', 'Vehicle had a permit']}
          onCancel={() => setAsk(null)}
          onSubmit={(r) => void reportMistake(r)}
        />
      )}
    </div>
  );
}

/* ── patrol (AI) ────────────────────────────────────────────────────────── */
function PatrolTab({ session }: { session: Session }) {
  const pack = usePack();
  const s = useSync();
  const now = useNow();
  const [q, setQ] = useState('');
  const query = q.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const matches = useMemo(() => (query.length >= 3 && pack ? pack.watchlist.filter((w) => `${w.plate.code}${w.plate.number}`.includes(query) || w.plate.number.includes(query)) : []), [query, pack]);

  if (!pack)
    return (
      <div className="n-card g-empty">
        <Sparkles size={28} />
        <div>The patrol outlook loads the first time this phone is online, then works offline.</div>
        <button className="btn" onClick={() => void refreshFieldPack(true)} disabled={!s.online}>
          <RefreshCw size={15} /> Load now
        </button>
      </div>
    );
  const o = pack.outlook;
  return (
    <>
      <section className="n-card g-ai-panel">
        <div className="g-ai-head">
          <span className="g-ai-brand">
            <Sparkles size={14} /> AI patrol outlook
          </span>
          <span className="faint" style={{ fontSize: 11 }}>
            updated {ago(pack.at, now)}
            {s.online === false ? ' · offline copy' : ''}
          </span>
        </div>
        {o ? (
          <>
            <div className="g-ai-big">
              <div>
                <div className="kpi-value">{approx(o.next3)}</div>
                <div className="g-tile-label">next 3 hours</div>
              </div>
              <div>
                <div className="kpi-value">{approx(o.next24)}</div>
                <div className="g-tile-label">next 24 hours</div>
              </div>
              <div>
                <div className="kpi-value">{String(o.peakHour).padStart(2, '0')}:00</div>
                <div className="g-tile-label">expected peak</div>
              </div>
            </div>
            <ul className="g-ai-why">
              <li>
                {areaOf(session.user.area)?.label}: {o.count7} violations in the last 7 days ({o.trendPct >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />} {o.trendPct >= 0 ? '+' : ''}
                {o.trendPct}% vs the week before).
              </li>
              {o.topTypes.length > 0 && <li>Most common here: {o.topTypes.map((t) => `${t.label.toLowerCase()} (${t.n})`).join(', ')}.</li>}
              <li>Be visible around {String(o.peakHour).padStart(2, '0')}:00 — presence prevents violations, not only records them.</li>
            </ul>
          </>
        ) : (
          <p className="muted">Not enough records in your area yet for an outlook.</p>
        )}
        <div className="g-ai-foot">{pack.engine} · forecast from the last 14 days · a supervisor decides deployment</div>
      </section>

      <section className="n-card">
        <div className="g-section-head" style={{ marginTop: 0 }}>
          <h3>
            <Siren size={15} style={{ verticalAlign: '-2px' }} /> Plate watchlist
          </h3>
          <span className="faint" style={{ fontSize: 12 }}>
            {pack.watchlist.length} repeat offenders
          </span>
        </div>
        <div className="n-search">
          <Search size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Check a plate (e.g. 72814)" inputMode="text" autoCapitalize="characters" />
        </div>
        {query.length >= 3 ? (
          matches.length ? (
            <div className="g-watch">
              {matches.slice(0, 6).map((w) => (
                <div key={w.key} className="g-watch-row is-hit">
                  <PlateChip plate={w.plate} />
                  <div style={{ flex: 1 }}>
                    <b>{w.count} violations</b>
                    <div className="faint" style={{ fontSize: 12 }}>
                      {w.escalation}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="g-note g-note-ok" style={{ marginTop: 10 }}>
              <CheckCircle2 size={15} /> Not on the watchlist.
            </div>
          )
        ) : (
          <div className="g-watch">
            {pack.watchlist.slice(0, 5).map((w) => (
              <div key={w.key} className="g-watch-row">
                <PlateChip plate={w.plate} />
                <div style={{ flex: 1 }}>
                  <b>{w.count}×</b> <span className="faint">{Object.keys(w.types).map((k) => typeOf(k)?.short ?? k).join(', ')}</span>
                  <div className="faint" style={{ fontSize: 12 }}>
                    last {ago(w.last, now)} · {w.escalation}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="g-ai-foot">You are warned automatically when you enter a watchlisted plate — even offline.</div>
      </section>

      <section className="n-card">
        <div className="g-section-head" style={{ marginTop: 0 }}>
          <h3>City hotspots this week</h3>
        </div>
        <div className="g-hot">
          {pack.hotspots.map((h, i) => (
            <div key={h.areaId} className={`g-hot-row${h.areaId === pack.area ? ' is-mine' : ''}`}>
              <span className="g-hot-rank">{i + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{h.label}</div>
                <div className="faint" style={{ fontSize: 12 }}>
                  peak {h.peakWindow} · {h.topTypes.map((t) => t.label.toLowerCase()).join(', ')}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <b>{h.count7}</b>
                <div className={`g-trend ${h.trendPct >= 0 ? 'up' : 'down'}`}>
                  {h.trendPct >= 0 ? '+' : ''}
                  {h.trendPct}%
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

/* ── settings ───────────────────────────────────────────────────────────── */
function SettingsTab({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const s = useSync();
  const sw = useSw();
  const gpsMode = useGpsMode();
  const theme = useTheme();
  const [dev, setDev] = useState<{ deviceId: string; name: string } | null>(null);
  const [name, setName] = useState('');
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void deviceInfo().then((d) => {
      setDev(d);
      setName(d.name);
    });
    void navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
  }, []);
  return (
    <>
      <section className="n-card g-settings">
        <div className="g-profile">
          <div className="g-avatar is-lg">
            {session.user.name
              .split(' ')
              .map((p) => p[0])
              .slice(0, 2)
              .join('')}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{session.user.name}</div>
            <div className="muted">
              {session.user.id} · {areaOf(session.user.area)?.label ?? 'All areas'}
            </div>
          </div>
          {session.offline ? <span className="chip chip-warning">offline sign-in</span> : <span className="chip chip-success">verified</span>}
        </div>
      </section>

      <div className="n-group-label">Location</div>
      <section className="n-card n-group">
        <div className="n-row">
          <div className="n-row-icon">{gpsMode === 'demo' ? <FlaskConical size={18} /> : <Crosshair size={18} />}</div>
          <div className="n-row-main">
            <div className="n-row-title">GPS source</div>
            <div className="n-row-sub">{gpsMode === 'demo' ? 'Demo position in your Abu Dhabi patrol area (labelled DEMO everywhere)' : "This phone's GPS receiver"}</div>
          </div>
        </div>
        <div className="n-segment n-segment-in">
          <button className={gpsMode === 'demo' ? 'is-on' : ''} onClick={() => setGpsMode('demo')}>
            Demo (Abu Dhabi)
          </button>
          <button className={gpsMode === 'real' ? 'is-on' : ''} onClick={() => setGpsMode('real')}>
            Real GPS
          </button>
        </div>
        {wasAutoSwitched() && gpsMode === 'demo' && (
          <div className="g-note g-note-info" style={{ margin: '0 14px 14px' }}>
            <Info size={15} /> This phone's GPS is outside the UAE, so the demo position is used.
          </div>
        )}
      </section>

      <PrinterSettingsSection officerName={session.user.name} officerId={session.user.id} />
      <FineScheduleSection role={session.user.role} />

      <div className="n-group-label">This device</div>
      <section className="n-card n-group">
        <div className="n-row n-row-col">
          <label htmlFor="dn" className="n-row-title">
            Device name <span className="faint">(shown on the dashboard)</span>
          </label>
          <div style={{ display: 'flex', gap: 8, width: '100%' }}>
            <input id="dn" className="input" value={name} placeholder={platformLabel().label} onChange={(e) => (setName(e.target.value), setSaved(false))} />
            <button
              className="btn"
              onClick={async () => {
                await renameDevice(name);
                await connectSocket();
                setSaved(true);
              }}
            >
              {saved ? <CheckCircle2 size={16} /> : 'Save'}
            </button>
          </div>
        </div>
        <InfoRow label="Server" value={`${s.online ? 'Reachable' : s.online === false ? 'Not reachable' : 'Checking'}${s.socket ? ' · live' : ''}`} />
        <InfoRow label="Offline mode" value={sw.offlineReady ? 'Ready — opens without internet' : 'Not ready (open once online over https)'} good={sw.offlineReady} />
        <InfoRow label="Installed" value={isStandalone() ? 'Yes — Home Screen app' : 'No — in the browser'} good={isStandalone()} />
        <InfoRow label="Storage" value={persisted ? 'Protected from clean-up' : persisted === false ? 'Standard' : 'Unknown'} />
        <InfoRow label="Device id" value={`${dev?.deviceId.slice(0, 8) ?? '…'}…`} mono />
        <InfoRow label="Version" value={APP_VERSION} />
      </section>

      <div className="n-group-label">Appearance</div>
      <section className="n-card n-group">
        <div className="n-segment n-segment-in" style={{ marginTop: 14 }}>
          <button className={theme === 'dark' ? 'is-on' : ''} onClick={() => applyTheme('dark')}>
            <Moon size={15} /> Dark
          </button>
          <button className={theme === 'light' ? 'is-on' : ''} onClick={() => applyTheme('light')}>
            <Sun size={15} /> Light
          </button>
        </div>
      </section>

      <button className="btn btn-lg btn-block n-secondary" style={{ marginTop: 6 }} onClick={onSignOut}>
        <LogOut size={17} /> Sign out
      </button>
      <p className="faint" style={{ fontSize: 12, textAlign: 'center', margin: '8px 0 0' }}>
        Signing out keeps unsent records on the phone; they still upload for the guard who recorded them.
      </p>
      <p className="faint" style={{ fontSize: 11, textAlign: 'center', margin: '14px 0 0' }}>
        <Clock size={11} style={{ verticalAlign: '-1px' }} /> Park Patrol {APP_VERSION} · Astrikos
      </p>
    </>
  );
}

function InfoRow({ label, value, good, mono }: { label: string; value: string; good?: boolean; mono?: boolean }) {
  return (
    <div className="n-row">
      <div className="n-row-main">
        <div className="n-row-sub">{label}</div>
      </div>
      <div className={`n-row-value${good ? ' is-good' : ''}${mono ? ' mono' : ''}`}>{value}</div>
    </div>
  );
}

