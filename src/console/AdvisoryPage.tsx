/**
 * AI Advisory — the full page (theme §10.4).
 *
 * Everything here comes from shared/intel.js: deterministic, explainable, and
 * computed from the live records. The brief can be WORDED by a language model
 * when one is configured on the server — it only rephrases the engine's
 * numbers. Every section names its engine and ends with "a supervisor decides":
 * the AI never changes a record on its own.
 *
 * Use cases:
 *   1. Ranked actions — what to deal with first and why (safety backlog,
 *      guard-reported mistakes, repeat offenders, duplicates, surges).
 *   2. Forecast — expected violations per hour and per area, next 24 h.
 *   3. Hotspots — where and when violations concentrate, week on week.
 *   4. Repeat offenders — plates to escalate (warning → higher fine → clamp/tow);
 *      the same list warns guards on their phones, offline.
 *   5. Anomalies — duplicates, clock drift, coverage gaps, inactive guards.
 *   6. Deployment — which guard to move where, for the peak.
 *   7. Plate check — a vision model double-checks each uploaded plate (when configured).
 */
import { useState } from 'react';
import { AlertTriangle, ArrowRight, Info, Loader2, MapPin, RefreshCw, Siren, Sparkles, TrendingDown, TrendingUp, Users, Wand2 } from 'lucide-react';
import { request, typeOf, ago } from '../lib/api';
import { PlateChip, useNow } from '../lib/ui';
import type { Live } from './useLive';
import type { Nav } from './ConsoleApp';
import { Kpi, MapView, useToast } from './parts';
import { AdvisoryRow } from './advisory';


export default function AdvisoryPage({ live, nav, focusArea }: { live: Live; nav: Nav; focusArea: string | null }) {
  const toast = useToast();
  const now = useNow(30_000);
  const intel = live.intel;
  const [brief, setBrief] = useState<{ text: string; engine: string } | null>(null);
  const [writing, setWriting] = useState(false);

  if (!intel)
    return (
      <div className="c-loading">
        <Loader2 className="spin" /> Working out the advisory…
      </div>
    );

  const fc = intel.forecast;
  const top = intel.hotspots[0];
  const maxHour = Math.max(1, ...fc.hourly.map((h) => h.expected));
  const maxArea = Math.max(1, ...fc.areas.map((a) => a.next24));
  const recent7 = live.violations.filter((v) => !v.voided && v.capturedAt >= Date.now() - 7 * 86_400_000);

  async function write() {
    setWriting(true);
    try {
      const r = await request<{ text: string; engine: string; note?: string }>('/api/intel/brief', { method: 'POST', token: live.token, timeoutMs: 45_000 });
      setBrief(r);
      if (r.note) toast(r.note, 'error');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setWriting(false);
    }
  }

  return (
    <>
      <div className="c-kpis c-kpis-6">
        <Kpi label="Expected next 24 h" value={`~${fc.next24}`} sub={`confidence ${fc.confidence}% · trend ×${fc.trendFactor}`} tone="advisory" />
        <Kpi label="Top hotspot" value={top ? top.count7 : 0} sub={top ? `${top.label.replace(/ \(.*\)$/, '')} · this week` : 'no data'} tone="warning" onClick={top ? () => nav.go('violations', {}) : undefined} />
        <Kpi label="Repeat offenders" value={intel.offenders.length} sub={`${intel.offenders.filter((o) => o.count >= 3).length} to escalate`} tone="danger" />
        <Kpi label="Actions waiting" value={intel.advisories.filter((a) => a.priority === 'critical' || a.priority === 'high').length} sub="critical + high" tone="danger" />
        <Kpi label="Anomalies" value={intel.anomalies.length} sub="duplicates, gaps, drift" tone="info" />
        <Kpi label="Mistake reports" value={live.stats?.corrections ?? 0} sub="from guards" tone="warning" onClick={() => nav.go('violations')} />
      </div>

      <section className="card overview-advisory">
        <div className="card-head">
          <div>
            <h3 className="adv-panel-title">
              <Sparkles size={15} /> Brief
            </h3>
            <div className="faint" style={{ fontSize: 12 }}>
              Updated {ago(intel.at, now)} · {brief ? brief.engine : intel.engine}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-sm btn-ghost" onClick={() => void live.refreshIntel()}>
              <RefreshCw size={14} /> Refresh
            </button>
            <button
              className="btn btn-sm"
              onClick={() => void write()}
              disabled={writing || !intel.ai?.ready}
              title={intel.ai?.ready ? `Word the brief with ${intel.ai.label}` : intel.ai?.reason || 'No language model configured on the server (LLM_PROVIDER / LLM_API_KEY)'}
            >
              {writing ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />} {intel.ai?.ready ? 'Write with AI' : 'AI writer off'}
            </button>
          </div>
        </div>
        <div className="card-pad">
          {brief ? (
            <div className="c-brief">{brief.text}</div>
          ) : (
            <ul className="adv-summary" style={{ margin: 0 }}>
              {intel.summary.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <div className="c-grid-2">
        <section className="card">
          <div className="card-head">
            <div>
              <h3>Deal with first</h3>
              <div className="faint" style={{ fontSize: 12 }}>
                Ranked by safety, then money, then prediction
              </div>
            </div>
            <span className="chip chip-advisory">{intel.advisories.length}</span>
          </div>
          <ul className="adv-list c-adv-page">
            {intel.advisories.map((a, i) => (
              <AdvisoryRow key={a.id} a={a} rank={i + 1} onAct={nav.runAdvisory} defaultOpen={i === 0} />
            ))}
            {!intel.advisories.length && <li className="c-empty">Nothing needs attention right now.</li>}
          </ul>
          <div className="adv-foot c-pad-foot">
            <span className="chip">{intel.engine}</span> A supervisor decides the action.
          </div>
        </section>

        <div className="c-side">
          <section className="card">
            <div className="card-head">
              <div>
                <h3>Forecast — next 24 hours</h3>
                <div className="faint" style={{ fontSize: 12 }}>
                  Expected violations per hour, city-wide
                </div>
              </div>
            </div>
            <div className="card-pad">
              <svg className="c-chart" viewBox="0 0 480 150" role="img" aria-label={`Forecast: about ${fc.next24} violations in the next 24 hours`}>
                {[0.25, 0.5, 0.75, 1].map((g) => (
                  <line key={g} x1="0" x2="480" y1={130 - g * 112} y2={130 - g * 112} className="c-chart-grid" />
                ))}
                {fc.hourly.map((h, i) => {
                  const bh = Math.max(1.5, (h.expected / maxHour) * 112);
                  return (
                    <g key={i}>
                      <rect x={i * 20 + 3} y={130 - bh} width="14" height={bh} rx="3" className={i < 3 ? 'c-chart-bar is-near' : 'c-chart-bar'}>
                        <title>
                          {String(h.hour).padStart(2, '0')}:00 — ~{h.expected}
                        </title>
                      </rect>
                      {i % 3 === 0 && (
                        <text x={i * 20 + 10} y="146" className="c-chart-label" textAnchor="middle">
                          {String(h.hour).padStart(2, '0')}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
              <div className="faint" style={{ fontSize: 11.5 }}>
                <span className="c-legend-sq is-near" /> next 3 h · Method: {fc.method}. A staffing guide, not a promise.
              </div>
            </div>
            <div className="c-stages">
              {fc.areas.slice(0, 7).map((a) => (
                <button key={a.areaId} className="stage-row" onClick={() => nav.focusArea(a.areaId)} title="Show on the map">
                  <span className="c-ellipsis">{a.label}</span>
                  <span className="stage-bar">
                    <span className="stage-fill" style={{ width: `${(a.next24 / maxArea) * 100}%` }} />
                  </span>
                  <span className="stage-n">~{a.next24}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h3>
                <Users size={15} style={{ verticalAlign: '-2px' }} /> Deployment
              </h3>
            </div>
            <div className="card-pad c-deploy">
              {intel.deployment.suggestions.length ? (
                intel.deployment.suggestions.map((s) => (
                  <div key={s.guardId} className="c-deploy-row">
                    <div className="c-deploy-move">
                      <b>{s.guardName}</b>
                      <span className="faint">{s.from.replace(/ \(.*\)$/, '')}</span>
                      <ArrowRight size={14} />
                      <b>{s.to.replace(/ \(.*\)$/, '')}</b>
                      <span className="chip">from {s.window}</span>
                    </div>
                    <div className="faint" style={{ fontSize: 12 }}>
                      {s.reason}
                    </div>
                  </div>
                ))
              ) : (
                <div className="faint">Coverage matches the forecast — no moves suggested.</div>
              )}
            </div>
          </section>
        </div>
      </div>

      <div className="c-grid-2">
        <section className="card">
          <div className="card-head">
            <div>
              <h3>
                <MapPin size={15} style={{ verticalAlign: '-2px' }} /> Hotspots this week
              </h3>
              <div className="faint" style={{ fontSize: 12 }}>
                Circles = hotspot size · dots = last 7 days · tokens = guards
              </div>
            </div>
          </div>
          <MapView violations={recent7} devices={live.devices} hotspots={intel.hotspots} focusArea={focusArea} onOpen={(id) => nav.openRecord(id)} height={380} />
          <div className="c-hot-list">
            {intel.hotspots.slice(0, 6).map((h, i) => (
              <button key={h.areaId} className="c-hot-row" onClick={() => nav.focusArea(h.areaId)}>
                <span className="adv-rank">{i + 1}</span>
                <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <b>{h.label}</b>
                  <span className="faint" style={{ display: 'block', fontSize: 12 }}>
                    peak {h.peakWindow} · {h.topTypes.map((t) => t.label).join(', ')}
                  </span>
                </span>
                <span style={{ textAlign: 'right' }}>
                  <b>{h.count7}</b>
                  <span className={`c-trend ${h.trendPct >= 0 ? 'up' : 'down'}`}>
                    {h.trendPct >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />} {h.trendPct >= 0 ? '+' : ''}
                    {h.trendPct}%
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>

        <div className="c-side">
          <section className="card">
            <div className="card-head">
              <div>
                <h3>
                  <Siren size={15} style={{ verticalAlign: '-2px' }} /> Repeat offenders
                </h3>
                <div className="faint" style={{ fontSize: 12 }}>
                  Guards are warned on their phones when they enter these plates — offline too
                </div>
              </div>
            </div>
            <div className="c-table-wrap" style={{ maxHeight: 320 }}>
              <table className="c-table">
                <thead>
                  <tr>
                    <th>Plate</th>
                    <th className="num">Count</th>
                    <th>Mostly</th>
                    <th>Last</th>
                    <th>Escalation</th>
                  </tr>
                </thead>
                <tbody>
                  {intel.offenders.slice(0, 20).map((o) => (
                    <tr key={o.key} onClick={() => nav.go('violations', { plate: o.key })} title="Show this plate's records">
                      <td>
                        <PlateChip plate={o.plate} />
                      </td>
                      <td className="num">
                        <b>{o.count}</b>
                      </td>
                      <td className="c-ellipsis">
                        {Object.entries(o.types)
                          .sort((a, b) => b[1] - a[1])
                          .map(([k]) => typeOf(k)?.short ?? k)
                          .join(', ')}
                      </td>
                      <td className="faint">{ago(o.last, now)}</td>
                      <td>
                        <span className={`chip ${o.count >= 4 ? 'chip-danger' : o.count >= 3 ? 'chip-warning' : ''}`}>{o.escalation}</span>
                      </td>
                    </tr>
                  ))}
                  {!intel.offenders.length && (
                    <tr>
                      <td colSpan={5} className="c-empty">
                        No repeat offenders yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h3>Anomalies & data quality</h3>
              <span className="chip">{intel.anomalies.length}</span>
            </div>
            <div className="card-pad c-anoms">
              {intel.anomalies.length ? (
                intel.anomalies.map((a, i) => (
                  <button key={i} className={`adv-note tone-${a.tone}`} onClick={() => a.ids[0] && nav.openRecord(a.ids[a.ids.length - 1])} disabled={!a.ids.length}>
                    {a.tone === 'info' ? <Info size={15} /> : <AlertTriangle size={15} />}
                    <span>
                      <b>{a.title}</b>
                      <span className="faint" style={{ display: 'block', fontSize: 12 }}>
                        {a.detail}
                      </span>
                    </span>
                  </button>
                ))
              ) : (
                <div className="faint">No anomalies.</div>
              )}
            </div>
          </section>
        </div>
      </div>

      <p className="faint c-ai-disclaimer">
        <Sparkles size={12} /> {intel.engine}. Forecasts and rankings are computed from the records on this system and explained line by line; plate checks and the written brief use{' '}
        {intel.ai?.ready ? `${intel.ai.label} (${intel.ai.model})` : 'a language model only when one is configured on the server'}. The AI never changes a record — a supervisor decides.
      </p>
    </>
  );
}
