/**
 * Field Team — who is out there, on which phone, and are they online.
 *
 * One row per account: online now (any of their devices connected), the
 * device they last used, today's count, how many of their records were
 * captured offline, last seen. Supervisors can add a guard, reset a password
 * and deactivate an account (deactivating ends their sessions; anything still
 * queued on their phone stays on the phone).
 */
import { useMemo, useState } from 'react';
import { KeyRound, Loader2, Power, Smartphone, UserPlus, X, AlertTriangle, Search } from 'lucide-react';
import { request, ApiError, AREAS, areaOf, ago, type TeamRow, type User } from '../lib/api';
import { useNow } from '../lib/ui';
import type { Live } from './useLive';

export default function TeamPage({ live, token, me }: { live: Live; token: string; me: User }) {
  const now = useNow(20_000);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [resetFor, setResetFor] = useState<TeamRow | null>(null);

  const rows = useMemo(() => {
    const order = { guard: 0, supervisor: 1, admin: 2 } as Record<string, number>;
    return live.team
      .filter((r) => !q || `${r.name} ${r.id} ${areaOf(r.area)?.label ?? ''}`.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => Number(b.online) - Number(a.online) || order[a.role] - order[b.role] || a.name.localeCompare(b.name));
  }, [live.team, q]);
  const guards = live.team.filter((r) => r.role === 'guard');

  async function toggleActive(r: TeamRow) {
    try {
      await request(`/api/team/${r.id}`, { method: 'PATCH', token, body: JSON.stringify({ active: !r.active }) });
      await live.reloadTeam();
      setMsg(`${r.name} ${r.active ? 'deactivated' : 'reactivated'}`);
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  return (
    <>
      <div className="c-kpis">
        <div className="card c-kpi c-kpi-static">
          <div className="eyebrow">Guards</div>
          <div className="kpi-value">{guards.filter((g) => g.active).length}</div>
          <div className="faint" style={{ fontSize: 12 }}>
            active accounts
          </div>
        </div>
        <div className="card c-kpi c-kpi-static c-kpi-success">
          <div className="eyebrow">Online now</div>
          <div className="kpi-value">{guards.filter((g) => g.online).length}</div>
          <div className="faint" style={{ fontSize: 12 }}>
            app open and connected
          </div>
        </div>
        <div className="card c-kpi c-kpi-static c-kpi-info">
          <div className="eyebrow">Recorded today</div>
          <div className="kpi-value">{guards.reduce((n, g) => n + g.today, 0)}</div>
          <div className="faint" style={{ fontSize: 12 }}>
            by the field team
          </div>
        </div>
        <div className="card c-kpi c-kpi-static c-kpi-warning">
          <div className="eyebrow">Devices seen</div>
          <div className="kpi-value">{live.devices.length}</div>
          <div className="faint" style={{ fontSize: 12 }}>
            phones that have signed in
          </div>
        </div>
      </div>

      {msg && (
        <div className="c-flash" onClick={() => setMsg(null)}>
          {msg}
        </div>
      )}

      <section className="card">
        <div className="card-head">
          <div>
            <h3>Field team</h3>
            <div className="faint" style={{ fontSize: 12 }}>
              Online = the Park Patrol app is open and connected on one of their phones
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div className="c-search">
              <Search size={14} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, id, area" />
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
              <UserPlus size={15} /> Add guard
            </button>
          </div>
        </div>
        <div className="c-table-wrap">
          <table className="c-table c-team">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Patrol area</th>
                <th>Status</th>
                <th>Device</th>
                <th className="num">Today</th>
                <th className="num">Total</th>
                <th className="num">Captured offline</th>
                <th>Last record</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const dev = [...r.devices].sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0))[0];
                return (
                  <tr key={r.id} className={r.active ? '' : 'is-inactive'}>
                    <td>
                      <div style={{ fontWeight: 700 }}>{r.name}</div>
                      <div className="faint mono" style={{ fontSize: 11 }}>
                        {r.id}
                        {r.phone ? ` · ${r.phone}` : ''}
                      </div>
                    </td>
                    <td>
                      <span className={`chip ${r.role === 'guard' ? '' : 'chip-accent'}`}>{r.role}</span>
                    </td>
                    <td className="c-ellipsis">{areaOf(r.area)?.label ?? '—'}</td>
                    <td>
                      {!r.active ? (
                        <span className="chip chip-danger">Deactivated</span>
                      ) : r.online ? (
                        <span className="chip chip-success">
                          <span className="dot dot-on" /> Online
                        </span>
                      ) : (
                        <span className="chip">
                          <span className="dot dot-off" /> {r.lastSeen ? `Seen ${ago(r.lastSeen, now)}` : 'Not signed in yet'}
                        </span>
                      )}
                    </td>
                    <td className="c-ellipsis">
                      {dev ? (
                        <span title={dev.deviceId}>
                          <Smartphone size={13} style={{ verticalAlign: '-2px' }} /> {dev.label}
                          {r.devices.length > 1 ? ` +${r.devices.length - 1}` : ''}
                        </span>
                      ) : (
                        <span className="faint">—</span>
                      )}
                    </td>
                    <td className="num">{r.today}</td>
                    <td className="num">{r.total}</td>
                    <td className="num">{r.offlineCaptured}</td>
                    <td className="faint">{r.lastRecord ? ago(r.lastRecord, now) : '—'}</td>
                    <td>
                      <div className="c-row-actions">
                        <button className="icon-btn" title="Reset password" onClick={() => setResetFor(r)}>
                          <KeyRound size={16} />
                        </button>
                        {r.id !== me.id && (
                          <button className="icon-btn" title={r.active ? 'Deactivate' : 'Reactivate'} onClick={() => void toggleActive(r)}>
                            <Power size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <h3>Devices</h3>
          <span className="faint" style={{ fontSize: 12 }}>
            Pending = records the phone was still holding when it last connected
          </span>
        </div>
        <div className="c-table-wrap">
          <table className="c-table">
            <thead>
              <tr>
                <th>Device</th>
                <th>Signed in</th>
                <th>Status</th>
                <th>Last upload</th>
                <th className="num">Pending at connect</th>
                <th>First seen</th>
                <th>App</th>
              </tr>
            </thead>
            <tbody>
              {live.devices.length === 0 && (
                <tr>
                  <td colSpan={7} className="c-empty">
                    No phone has connected yet.
                  </td>
                </tr>
              )}
              {live.devices.map((d) => (
                <tr key={d.deviceId}>
                  <td>
                    <div style={{ fontWeight: 700 }}>{d.label}</div>
                    <div className="faint mono" style={{ fontSize: 11 }}>
                      {d.deviceId.slice(0, 8)}
                    </div>
                  </td>
                  <td>{d.userName ?? '—'}</td>
                  <td>
                    {d.online ? (
                      <span className="chip chip-success">
                        <span className="dot dot-on" /> Online
                      </span>
                    ) : (
                      <span className="chip">
                        <span className="dot dot-off" /> Offline · {ago(d.lastSeen, now)}
                      </span>
                    )}
                  </td>
                  <td className="faint">{d.lastSync ? ago(d.lastSync, now) : '—'}</td>
                  <td className="num">{d.pendingAtHello ?? 0}</td>
                  <td className="faint">{ago(d.firstSeen, now)}</td>
                  <td className="faint">{d.appVersion || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {adding && (
        <AddGuard
          token={token}
          canAddStaff={me.role === 'admin'}
          onClose={() => setAdding(false)}
          onDone={async (name) => {
            setAdding(false);
            await live.reloadTeam();
            setMsg(`${name} added — they can sign in on a phone now (online the first time)`);
          }}
        />
      )}
      {resetFor && (
        <ResetPassword
          row={resetFor}
          token={token}
          onClose={() => setResetFor(null)}
          onDone={() => {
            setMsg(`Password changed for ${resetFor.name}. Their phone's offline sign-in updates at their next online sign-in.`);
            setResetFor(null);
          }}
        />
      )}
    </>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="c-modal-wrap" onClick={onClose}>
      <div className="card c-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
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

function AddGuard({ token, canAddStaff, onClose, onDone }: { token: string; canAddStaff: boolean; onClose: () => void; onDone: (name: string) => void }) {
  const [f, setF] = useState({ name: '', id: '', role: 'guard', area: AREAS[0].id, phone: '', password: 'Astrikos2026' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await request('/api/team', { method: 'POST', token, body: JSON.stringify(f) });
      onDone(f.name);
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : 'Could not reach the server');
      setBusy(false);
    }
  }
  return (
    <Modal title="Add to field team" onClose={onClose}>
      <form className="c-form" onSubmit={submit}>
        <div className="field">
          <label>Full name</label>
          <input className="input" value={f.name} onChange={set('name')} required />
        </div>
        <div className="c-form-2">
          <div className="field">
            <label>Login id</label>
            <input className="input" value={f.id} onChange={set('id')} placeholder="e.g. guard5" autoCapitalize="none" required />
          </div>
          <div className="field">
            <label>Role</label>
            <select className="select" value={f.role} onChange={set('role')}>
              <option value="guard">Guard</option>
              {canAddStaff && <option value="supervisor">Supervisor</option>}
            </select>
          </div>
        </div>
        <div className="c-form-2">
          <div className="field">
            <label>Patrol area</label>
            <select className="select" value={f.area} onChange={set('area')}>
              {AREAS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Phone (optional)</label>
            <input className="input" value={f.phone} onChange={set('phone')} />
          </div>
        </div>
        <div className="field">
          <label>Initial password</label>
          <input className="input" value={f.password} onChange={set('password')} minLength={6} required />
        </div>
        {err && (
          <div className="form-error">
            <AlertTriangle size={16} /> {err}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? <Loader2 size={16} className="spin" /> : <UserPlus size={16} />} Add
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ResetPassword({ row, token, onClose, onDone }: { row: TeamRow; token: string; onClose: () => void; onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 6) return setErr('At least 6 characters');
    setBusy(true);
    try {
      await request(`/api/team/${row.id}`, { method: 'PATCH', token, body: JSON.stringify({ password: pw }) });
      onDone();
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal title={`Reset password — ${row.name}`} onClose={onClose}>
      <form className="c-form" onSubmit={submit}>
        <div className="field">
          <label>New password</label>
          <input className="input" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        </div>
        {err && (
          <div className="form-error">
            <AlertTriangle size={16} /> {err}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? <Loader2 size={16} className="spin" /> : <KeyRound size={16} />} Set password
          </button>
        </div>
      </form>
    </Modal>
  );
}
