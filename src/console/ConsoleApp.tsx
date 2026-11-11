/**
 * The control-room dashboard — deliberately small for this POC: two pages.
 *
 *   Dashboard   KPIs, the live feed of violations (new ones arrive without a
 *               refresh, with a "captured offline" badge), a map, and devices.
 *   Field Team  guards, which device each is signed in on, online/offline,
 *               today's count; add a guard, reset a password, deactivate.
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Eye, EyeOff, LayoutDashboard, Loader2, Lock, LogOut, Moon, Sun, Users } from 'lucide-react';
import { request, ApiError, type User } from '../lib/api';
import { Brand, applyTheme, useTheme } from '../lib/ui';
import { useLive } from './useLive';
import DashboardPage from './DashboardPage';
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

type Page = 'dashboard' | 'team';
const pageFromPath = (): Page => (/^\/team/.test(window.location.pathname) ? 'team' : 'dashboard');

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
  return <Shell session={session} onSignOut={signOut} />;
}

function Shell({ session, onSignOut }: { session: ConsoleSession; onSignOut: () => void }) {
  const [page, setPage] = useState<Page>(pageFromPath);
  const theme = useTheme();
  const live = useLive(session.token, onSignOut);

  useEffect(() => {
    const onPop = () => setPage(pageFromPath());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const go = (p: Page) => {
    window.history.pushState(null, '', p === 'team' ? '/team' : '/');
    setPage(p);
  };

  return (
    <div className="c-shell">
      <header className="c-header">
        <Brand sub="Violation Control Room · Abu Dhabi" />
        <nav className="c-tabs">
          <button className={page === 'dashboard' ? 'is-active' : ''} onClick={() => go('dashboard')}>
            <LayoutDashboard size={16} /> Dashboard
          </button>
          <button className={page === 'team' ? 'is-active' : ''} onClick={() => go('team')}>
            <Users size={16} /> Field Team
          </button>
        </nav>
        <div className="c-header-right">
          {live.live ? (
            <span className="chip chip-success">
              <span className="dot dot-on pulse" /> Live
            </span>
          ) : (
            <span className="chip chip-warning" title="Real-time link down — refreshing every 15 s">
              <span className="dot dot-warn" /> Reconnecting
            </span>
          )}
          <button className="icon-btn" onClick={() => applyTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme">
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
          <DashboardPage live={live} />
        ) : (
          <TeamPage live={live} token={session.token} me={session.user} />
        )}
      </main>
    </div>
  );
}

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
          <div className="form-error">
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
