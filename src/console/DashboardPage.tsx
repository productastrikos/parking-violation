/**
 * Dashboard — the overview.
 *
 *   AI advisory panel (theme §10.2): summary + the top four priorities.
 *   KPIs — each filters the live feed in place.
 *   Live feed: a record captured on a phone with no signal appears here the
 *   moment the phone reconnects, highlighted, with "Captured offline".
 *   Map: violations, hotspots, and guards' live positions (DEMO-labelled).
 *   Devices: which phone, which guard, online/offline, last upload.
 */
import { useMemo, useState } from 'react';
import { CheckCircle2, ChevronRight, Smartphone, Sparkles, WifiOff, Flag } from 'lucide-react';
import { areaOf, ago, duration, fmtDate, fmtTime } from '../lib/api';
import { PlateChip, useNow } from '../lib/ui';
import type { Live } from './useLive';
import type { Nav } from './ConsoleApp';
import { Kpi, MapView, StatusChip, TypeCell } from './parts';
import { PRIORITY } from './advisory';

type Filter = 'today' | 'offline' | 'new' | 'all';

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export default function DashboardPage({ live, nav }: { live: Live; nav: Nav }) {
  const { stats, violations, devices, fresh, intel } = live;
  const [filter, setFilter] = useState<Filter>('today');
  const now = useNow(20_000);

  const list = useMemo(() => {
    const today = startOfToday();
    const sorted = violations.filter((v) => !v.voided).sort((a, b) => b.receivedAt - a.receivedAt);
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

  const online = devices.filter((d) => d.online).length;

  return (
    <>
      {intel && (
        <section className="card overview-advisory">
          <div className="card-head">
            <div>
              <h3 className="adv-panel-title">
                <Sparkles size={15} /> AI Advisory
              </h3>
              <div className="faint" style={{ fontSize: 12 }}>
                What to deal with first, and why
              </div>
            </div>
            <button className="btn btn-sm btn-ghost" onClick={() => nav.go('advisory')}>
              Full advisory <ChevronRight size={14} />
            </button>
          </div>
          <ul className="adv-summary" style={{ padding: '10px 16px 0 34px', margin: 0 }}>
            {intel.summary.slice(0, 3).map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
          <div className="adv-strip">
            {intel.advisories.slice(0, 4).map((a) => (
              <button key={a.id} className={`adv-card tone-${PRIORITY[a.priority].tone}`} onClick={() => nav.runAdvisory(a)}>
                <div className="top">
                  <span className={`chip ${PRIORITY[a.priority].chip}`}>{PRIORITY[a.priority].label}</span>
                  <ChevronRight size={14} className="faint" />
                </div>
                <div className="t">{a.title}</div>
                <div className="h">{a.actions[0]}</div>
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="c-kpis">
        <Kpi label="Violations today" value={stats?.today ?? 0} sub={`${stats?.total ?? 0} on record`} active={filter === 'today'} onClick={() => setFilter('today')} />
        <Kpi label="Captured offline" value={stats?.offlineTotal ?? 0} sub={`${stats?.todayOffline ?? 0} today · synced later`} tone="warning" active={filter === 'offline'} onClick={() => setFilter('offline')} />
        <Kpi label="Awaiting review" value={stats?.awaitingReview ?? 0} sub={stats?.corrections ? `${stats.corrections} mistake report${stats.corrections > 1 ? 's' : ''} from guards` : 'status: New'} tone="info" active={filter === 'new'} onClick={() => setFilter('new')} />
        <Kpi label="Devices online" value={`${online}/${devices.length}`} sub={`${stats?.guardsActive ?? 0} guards active`} tone="success" active={filter === 'all'} onClick={() => setFilter('all')} hint="Show all records" />
      </div>

      <div className="c-grid">
        <section className="card c-feed">
          <div className="card-head">
            <div>
              <h3>Live feed</h3>
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
              <button className="btn btn-sm" onClick={() => nav.go('violations')}>
                Manage <ChevronRight size={14} />
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
                {list.slice(0, 60).map((v) => {
                  const waited = v.receivedAt - v.capturedAt;
                  return (
                    <tr key={v.id} className={fresh.has(v.id) ? 'is-fresh' : ''} onClick={() => nav.openRecord(v.id)}>
                      <td>
                        <PlateChip plate={v.plate} />
                      </td>
                      <td>
                        <TypeCell v={v} />
                      </td>
                      <td className="c-ellipsis" title={areaOf(v.location?.areaId)?.label}>
                        {areaOf(v.location?.areaId)?.label.replace(/ \(.*\)$/, '') ?? '—'}
                      </td>
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
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                          <StatusChip v={v} />
                          {v.correction?.state === 'pending' && (
                            <span className="chip chip-warning" title="Guard reported a mistake">
                              <Flag size={11} />
                            </span>
                          )}
                          {v.seeded && <span className="c-sample">sample</span>}
                        </div>
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
                <span className="c-legend-dot is-guard" /> guards · <span className="c-legend-dot is-hot" /> hotspots
              </span>
            </div>
            <MapView violations={list} devices={devices} hotspots={intel?.hotspots ?? []} fresh={fresh} onOpen={(id) => nav.openRecord(id)} />
          </section>

          <section className="card">
            <div className="card-head">
              <h3>Devices</h3>
              <span className="faint" style={{ fontSize: 12 }}>
                {online} online
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
                      {d.position?.demo ? ' · demo GPS' : ''}
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
    </>
  );
}
