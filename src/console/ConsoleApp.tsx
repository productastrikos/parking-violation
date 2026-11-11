/**
 * The control-room dashboard.
 *
 * Shell (Astrikos theme §7.1–7.3, §7.9, §10.1): a left sidebar with the
 * subsystems grouped by workflow, a header with the page title, the AI
 * Advisory button (the one chrome control) and its popover, live status,
 * theme and the user. Pages:
 *
 *   Dashboard     overview: AI advisory panel, KPIs, live feed, map, devices
 *   Violations    every record: search, filter, select, bulk status, view and
 *                 edit (with reason), void / restore, guard correction requests
 *   AI Advisory   ranked actions, forecast, hotspots, repeat offenders,
 *                 anomalies, deployment — rules-based, a model optionally words it
 *   Field Team    guards, devices, live positions; add / reset / deactivate
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ChevronLeft, ChevronRight, Eye, EyeOff, LayoutDashboard, ListChecks, Loader2, Lock, LogOut, Menu, Moon, Sparkles, Sun, Users, X,
} from 'lucide-react';
import { request, ApiError, type User, type Advisory } from '../lib/api';
import { Brand, applyTheme, useTheme } from '../lib/ui';
import { useLive } from './useLive';
import { ToastHost, ViolationDrawer } from './parts';
import { AdvisoryRow } from './advisory';
import DashboardPage from './DashboardPage';
import ViolationsPage, { type ViolationQuery } from './ViolationsPage';
import AdvisoryPage from './AdvisoryPage';
import TeamPage from './TeamPage';
import './console.css';

interface ConsoleSession {
  token: string;
  user: User;
}
const KEY = 'pp.console.session';

function readSession(): ConsoleSession | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    return null;
  }
}

export type Page = 'dashboard' | 'violations' | 'advisory' | 'team';
const PATHS: Record<Page, string> = { dashboard: '/', violations: '/violations', advisory: '/advisory', team: '/team' };
const pageFromPath = (): Page => (Object.entries(PATHS).find(([, p]) => p !== '/' && window.location.pathname.startsWith(p))?.[0] as Page) ?? 'dashboard';

export interface Nav {
  go: (p: Page, query?: ViolationQuery) => void;
  openRecord: (id: string, edit?: boolean) => void;
  focusArea: (areaId: string) => void;
  runAdvisory: (a: Advisory) => void;
}

export default function ConsoleApp() {
  const [session, setSession] = useState<ConsoleSession | null>(readSession);
  const signOut = useCallback(() => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    setSession(null);
  }, []);
  if (!session) {
    return (
      <ConsoleSignIn
        onSignedIn={(s) => {
          try {
            localStorage.setItem(KEY, JSON.stringify(s));
          } catch {
            /* ignore */
          }
          setSession(s);
        }}
      />
    );
  }
  return (
    <ToastHost>
      <Shell session={session} onSignOut={signOut} />
    </ToastHost>
  );
}

const TITLES: Record<Page, { title: string; sub: string }> = {
  dashboard: { title: 'Dashboard', sub: 'Live enforcement across Abu Dhabi' },
  violations: { title: 'Violations', sub: 'Every record — review, correct, void' },
  advisory: { title: 'AI Advisory', sub: 'Where to act first, and why' },
  team: { title: 'Field Team', sub: 'Guards, devices and live positions' },
};

function Shell({ session, onSignOut }: { session: ConsoleSession; onSignOut: () => void }) {
  const [page, setPage] = useState<Page>(pageFromPath);
  const [query, setQuery] = useState<ViolationQuery | null>(null);
  const [drawer, setDrawer] = useState<{ id: string; edit: boolean } | null>(null);
  const [area, setArea] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('pp.sidebar') === 'collapsed';
    } catch {
      return false;
    }
  });
  const [mobileNav, setMobileNav] = useState(false);
  const [advOpen, setAdvOpen] = useState(false);
  const theme = useTheme();
  const live = useLive(session.token, onSignOut);

  useEffect(() => {
    const onPop = () => setPage(pageFromPath());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const go = useCallback((p: Page, q?: ViolationQuery) => {
    window.history.pushState(null, '', PATHS[p]);
    setPage(p);
    setQuery(q ?? null);
    setMobileNav(false);
    setAdvOpen(false);
    window.scrollTo({ top: 0 });
  }, []);

  const nav: Nav = useMemo(
    () => ({
      go,
      openRecord: (id, edit = false) => setDrawer({ id, edit }),
      focusArea: (a) => {
        setArea(a);
        go('advisory');
      },
      runAdvisory: (a) => {
        const c = a.cta;
        setAdvOpen(false);
        if (!c) return;
        if (c.action === 'open-record' && c.id) setDrawer({ id: c.id, edit: false });
        else if (c.action === 'open-filter') go('violations', { preset: c.filter });
        else if (c.action === 'open-plate') go('violations', { plate: c.plate });
        else if (c.action === 'open-area' && c.areaId) {
          setArea(c.areaId);
          go('advisory');
        } else if (c.action === 'open-team') go('team');
      },
    }),
    [go],
  );

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem('pp.sidebar', c ? 'open' : 'collapsed');
      } catch {
        /* ignore */
      }
      return !c;
    });
  };

  const urgentAi = (live.intel?.advisories ?? []).filter((a) => a.priority === 'critical' || a.priority === 'high').length;
  const newCount = live.stats?.awaitingReview ?? 0;
  const corrections = live.stats?.corrections ?? 0;
  const drawerRecord = drawer ? live.violations.find((v) => v.id === drawer.id) : null;

  const navItems: { section: string; items: { id: Page; label: string; icon: React.ReactNode; count?: number; urgent?: boolean }[] }[] = [
    { section: 'Command centre', items: [{ id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> }] },
    { section: 'Enforcement', items: [{ id: 'violations', label: 'Violations', icon: <ListChecks size={18} />, count: corrections || newCount || undefined, urgent: corrections > 0 }] },
    { section: 'Intelligence', items: [{ id: 'advisory', label: 'AI Advisory', icon: <Sparkles size={18} />, count: urgentAi || undefined, urgent: urgentAi > 0 }] },
    { section: 'Administration', items: [{ id: 'team', label: 'Field Team', icon: <Users size={18} /> }] },
  ];

  return (
    <div className={`c-app${collapsed ? ' is-collapsed' : ''}`}>
      {mobileNav && <div className="c-side-backdrop" onClick={() => setMobileNav(false)} />}
      <aside className={`c-sidebar${mobileNav ? ' is-open' : ''}`} aria-label="Navigation">
        <div className="c-side-brand">
          {collapsed ? <img src="/brand/astrikos-solo.png" alt="Park Patrol" className="c-side-logo" /> : <Brand sub="Violation Control Room" />}
          <button className="icon-btn c-side-close" onClick={() => setMobileNav(false)} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>
        <nav className="c-side-nav">
          {navItems.map((s) => (
            <div key={s.section}>
              {collapsed ? <div className="c-side-gap" /> : <p className="nav-section-label">{s.section}</p>}
              <div className="nav-list">
                {s.items.map((it) => (
                  <button key={it.id} className={`nav-item${page === it.id ? ' active' : ''}`} onClick={() => go(it.id)} title={collapsed ? it.label : undefined} aria-current={page === it.id ? 'page' : undefined}>
                    {it.icon}
                    {!collapsed && <span className="nav-label">{it.label}</span>}
                    {it.count ? <span className={`nav-count${it.urgent ? ' is-urgent' : ''}`}>{it.count}</span> : null}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="c-side-foot">
          {!collapsed && (
            <div className="c-side-status">
              <span className={`dot ${live.live ? 'dot-on' : 'dot-warn'}`} /> {live.live ? 'Live link' : 'Reconnecting…'}
              <span className="faint"> · {live.devices.filter((d) => d.online).length} phones online</span>
            </div>
          )}
          <button className="nav-item c-collapse" onClick={toggleCollapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
            {!collapsed && <span className="nav-label">Collapse</span>}
          </button>
          {!collapsed && <div className="powered-by">Powered by Astrikos</div>}
        </div>
      </aside>

      <div className="c-body">
        <header className="c-header">
          <button className="icon-btn c-menu" onClick={() => setMobileNav(true)} aria-label="Open menu">
            <Menu size={20} />
          </button>
          <div className="c-page-title">
            <h1>{TITLES[page].title}</h1>
            <div className="faint">{TITLES[page].sub}</div>
          </div>
          <div className="c-header-right">
            <AdvisoryButton open={advOpen} setOpen={setAdvOpen} count={urgentAi} live={live} nav={nav} />
            {live.live ? (
              <span className="chip chip-success c-live">
                <span className="dot dot-on pulse" /> Live
              </span>
            ) : (
              <span className="chip chip-warning c-live" title="Real-time link down — refreshing every 15 s">
                <span className="dot dot-warn" /> Reconnecting
              </span>
            )}
            <button className="icon-btn" onClick={() => applyTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme" title="Toggle theme">
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <div className="c-user">
              <div className="c-user-name">{session.user.name}</div>
              <div className="c-user-role">{session.user.role}</div>
            </div>
            <button className="icon-btn" onClick={onSignOut} aria-label="Sign out" title="Sign out">
              <LogOut size={18} />
            </button>
          </div>
        </header>
        {live.error && (
          <div className="c-alert">
            <AlertTriangle size={16} /> Could not reach the server: {live.error}
          </div>
        )}
        <main className="c-main">
          {!live.loaded ? (
            <div className="c-loading">
              <Loader2 className="spin" /> Loading…
            </div>
          ) : page === 'dashboard' ? (
            <DashboardPage live={live} nav={nav} />
          ) : page === 'violations' ? (
            <ViolationsPage live={live} nav={nav} query={query} key={JSON.stringify(query)} />
          ) : page === 'advisory' ? (
            <AdvisoryPage live={live} nav={nav} focusArea={area} />
          ) : (
            <TeamPage live={live} token={session.token} me={session.user} />
          )}
        </main>
      </div>

      {drawer && drawerRecord && <ViolationDrawer key={drawer.id + String(drawer.edit)} v={drawerRecord} live={live} startInEdit={drawer.edit} onClose={() => setDrawer(null)} />}
    </div>
  );
}

/* ── AI Advisory header button + popover (theme §7.9, §10.1) ───────────── */
function AdvisoryButton({ open, setOpen, count, live, nav }: { open: boolean; setOpen: (b: boolean) => void; count: number; live: ReturnType<typeof useLive>; nav: Nav }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open, setOpen]);
  const intel = live.intel;
  return (
    <div className="c-adv-anchor" ref={ref}>
      <button className={`app-advisory-btn${open ? ' is-on' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}>
        <Sparkles size={15} />
        <span>AI Advisory</span>
        {count > 0 && <span className="ai-top-count">{count}</span>}
      </button>
      {open && (
        <div className="adv-pop" role="dialog" aria-label="AI Advisory">
          <div className="adv-pop-head">
            <div>
              <div className="adv-panel-title">
                <Sparkles size={15} /> <b>AI Advisory</b>
              </div>
              <div className="faint" style={{ fontSize: 11 }}>
                Updated {intel ? new Date(intel.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
              </div>
            </div>
            <button className="btn btn-sm btn-ghost" onClick={() => nav.go('advisory')}>
              Full advisory →
            </button>
          </div>
          {!intel ? (
            <div className="c-loading" style={{ padding: 24 }}>
              <Loader2 className="spin" />
            </div>
          ) : (
            <>
              <ul className="adv-summary">
                {intel.summary.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
              <div className="adv-section-label">Deal with first</div>
              <ul className="adv-list">
                {intel.advisories.slice(0, 5).map((a, i) => (
                  <AdvisoryRow key={a.id} a={a} rank={i + 1} onAct={nav.runAdvisory} />
                ))}
                {!intel.advisories.length && <li className="faint">Nothing needs attention right now.</li>}
              </ul>
              <div className="adv-foot">
                <span className="chip">{intel.engine}</span> Ranked from records, hotspots and forecasts. A supervisor decides the action.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ── sign in ─────────────────────────────────────────────────────────────── */
function ConsoleSignIn({ onSignedIn }: { onSignedIn: (s: ConsoleSession) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await request<{ token: string; user: User }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: username.trim().toLowerCase(), password, surface: 'console' }),
      });
      onSignedIn(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Cannot reach the server');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="signin">
      <form className="card signin-card" onSubmit={submit}>
        <Brand sub="Violation Control Room" />
        <div>
          <h1 className="signin-title">Sign in</h1>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            Supervisors and admins. Guards use the Park Patrol app at <span className="mono">/app</span>.
          </p>
        </div>
        <div className="field">
          <label htmlFor="cu">Username</label>
          <input id="cu" className="input" autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="cp">Password</label>
          <div className="pw-wrap">
            <input id="cp" className="input" type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
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
        <button className="btn btn-primary btn-lg btn-block" disabled={busy}>
          {busy ? <Loader2 size={18} className="spin" /> : <Lock size={18} />} Sign in
        </button>
        <p className="signin-hint">Demo: admin or supervisor · password Astrikos2026</p>
      </form>
    </div>
  );
}
