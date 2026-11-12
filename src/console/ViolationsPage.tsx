/**
 * Violations — every record, and the controls to put mistakes right.
 *
 * Search (plate, reference, guard, notes), filters (status incl. voided, type,
 * area, guard, period, captured offline, guard-reported mistakes), sort,
 * paging, select + bulk status, CSV of exactly what is shown. Each row opens
 * the record drawer to view, edit (with a reason), void or restore.
 *
 * Nothing is deleted: a record is evidence. Voided records leave the KPIs and
 * the fines but stay here under "Voided", with who, when and why.
 */
import { useEffect, useMemo, useState } from 'react';
import { Download, Eye, Flag, Pencil, Search, Sparkles, WifiOff, X, ArrowDown, ArrowUp, Gavel, CheckCheck, Ban, Printer, ReceiptText } from 'lucide-react';
import { AREAS, STATUSES, VIOLATION_TYPES, areaOf, emirateOf, fmtDate, fmtTime, typeOf, type Violation } from '../lib/api';
import { PlateChip } from '../lib/ui';
import { plateKey } from '../../shared/intel.js';
import type { Live } from './useLive';
import type { Nav } from './ConsoleApp';
import { StatusChip, TypeCell, useToast } from './parts';
import { FinesModal } from './Notices';
import { fmtAed } from '../lib/notice';

export interface ViolationQuery {
  preset?: string; // 'high-new'
  plate?: string; // plate key
}

type Period = 'today' | '7d' | '30d' | 'all';
type SortKey = 'captured' | 'plate' | 'type' | 'area' | 'guard' | 'status';
const PAGE = 50;

type NoticeFilter = 'all' | 'printed' | 'unprinted' | 'reprinted';

export default function ViolationsPage({ live, nav, query, role }: { live: Live; nav: Nav; query: ViolationQuery | null; role: string }) {
  const [finesOpen, setFinesOpen] = useState(false);
  const [notice, setNotice] = useState<NoticeFilter>('all');
  const toast = useToast();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(query?.preset === 'high-new' ? 'new' : 'all');
  const [severity, setSeverity] = useState(query?.preset === 'high-new' ? 'high' : 'all');
  const [type, setType] = useState('all');
  const [area, setArea] = useState('all');
  const [guard, setGuard] = useState('all');
  const [period, setPeriod] = useState<Period>(query?.plate ? 'all' : '30d');
  const [offlineOnly, setOfflineOnly] = useState(false);
  const [mistakesOnly, setMistakesOnly] = useState(false);
  const [plate, setPlate] = useState(query?.plate ?? '');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'captured', dir: -1 });
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const guards = useMemo(() => [...new Map(live.violations.map((v) => [v.guardId, v.guardName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [live.violations]);

  const filtered = useMemo(() => {
    const from = period === 'all' ? 0 : period === 'today' ? new Date().setHours(0, 0, 0, 0) : Date.now() - (period === '7d' ? 7 : 30) * 86_400_000;
    const needle = q.trim().toLowerCase().replace(/\s+/g, '');
    const list = live.violations.filter((v) => {
      if (status === 'voided' ? !v.voided : v.voided) return false;
      if (status !== 'all' && status !== 'voided' && v.status !== status) return false;
      if (severity !== 'all' && v.severity !== severity) return false;
      if (type !== 'all' && v.type !== type) return false;
      if (area !== 'all' && v.location?.areaId !== area) return false;
      if (guard !== 'all' && v.guardId !== guard) return false;
      if (v.capturedAt < from) return false;
      if (offlineOnly && !v.capturedOffline) return false;
      if (mistakesOnly && v.correction?.state !== 'pending') return false;
      const prints = v.notices?.length ?? 0;
      if (notice === 'printed' && !prints) return false;
      if (notice === 'unprinted' && prints) return false;
      if (notice === 'reprinted' && prints < 2) return false;
      if (plate && plateKey(v.plate) !== plate) return false;
      if (needle) {
        const hay = `${v.plate.code}${v.plate.number} ${v.plate.number} ${v.ref} ${v.guardName} ${v.notes} ${v.location.landmark}`.toLowerCase().replace(/\s+/g, '');
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    const val = (v: Violation): string | number => {
      switch (sort.key) {
        case 'plate':
          return `${v.plate.number.padStart(5, '0')}${v.plate.code}`;
        case 'type':
          return typeOf(v.type)?.short ?? v.type;
        case 'area':
          return areaOf(v.location.areaId)?.label ?? '';
        case 'guard':
          return v.guardName;
        case 'status':
          return v.status;
        default:
          return v.capturedAt;
      }
    };
    return list.sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * sort.dir);
  }, [live.violations, q, status, severity, type, area, guard, period, offlineOnly, mistakesOnly, plate, sort, notice]);

  useEffect(() => setPage(0), [q, status, severity, type, area, guard, period, offlineOnly, mistakesOnly, plate, notice]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const rows = filtered.slice(page * PAGE, page * PAGE + PAGE);
  const allOnPage = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const mistakes = live.violations.filter((v) => v.correction?.state === 'pending' && !v.voided).length;
  const activeFilters = [status !== 'all', severity !== 'all', type !== 'all', area !== 'all', guard !== 'all', offlineOnly, mistakesOnly, Boolean(plate), Boolean(q), notice !== 'all'].filter(Boolean).length;

  function reset() {
    setQ('');
    setStatus('all');
    setSeverity('all');
    setType('all');
    setArea('all');
    setGuard('all');
    setPeriod('30d');
    setOfflineOnly(false);
    setMistakesOnly(false);
    setPlate('');
    setNotice('all');
  }

  function toggle(id: string) {
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function bulk(st: string) {
    setBusy(true);
    try {
      const n = await live.bulkStatus([...sel], st);
      toast(`${n} record${n === 1 ? '' : 's'} updated`);
      setSel(new Set());
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  function exportCsv(list: Violation[]) {
    const esc = (x: unknown) => `"${String(x ?? '').replace(/"/g, '""')}"`;
    const iso = (t?: number) => (t ? new Date(t).toISOString() : '');
    const head = ['ref', 'type', 'severity', 'emirate', 'code', 'number', 'area', 'landmark', 'lat', 'lng', 'demo_gps', 'guard', 'captured_at', 'received_at', 'captured_offline', 'status', 'voided', 'void_reason', 'edits', 'notes', 'notice_issued_at', 'notice_issued_by', 'fine_aed', 'notice_prints'];
    const lines = list.map((v) =>
      [
        v.ref, typeOf(v.type)?.label, v.severity, emirateOf(v.plate.emirate)?.label, v.plate.code, v.plate.number, areaOf(v.location.areaId)?.label, v.location.landmark,
        v.location.gps?.lat, v.location.gps?.lng, v.location.gps?.demo ? 'yes' : 'no', v.guardName, iso(v.capturedAt), iso(v.receivedAt), v.capturedOffline ? 'yes' : 'no',
        v.status, v.voided ? 'yes' : 'no', v.voidReason, v.edits?.length ?? 0, v.notes,
        iso(v.notices?.[0]?.at), v.notices?.[0]?.by, v.notices?.[0]?.notice.fine, v.notices?.length ?? 0,
      ].map(esc).join(','),
    );
    const blob = new Blob([`﻿${[head.join(','), ...lines].join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `violations-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(`Exported ${list.length} record${list.length === 1 ? '' : 's'}`);
  }

  const Th = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <th>
      <button className="c-th-btn" onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? (s.dir === 1 ? -1 : 1) : k === 'captured' ? -1 : 1 }))}>
        {children}
        {sort.key === k && (sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      </button>
    </th>
  );

  return (
    <>
      {mistakes > 0 && !mistakesOnly && (
        <button className="c-strip tone-warning" onClick={() => setMistakesOnly(true)}>
          <Flag size={16} /> {mistakes} record{mistakes > 1 ? 's' : ''} reported as a mistake by guards — review →
        </button>
      )}

      <section className="card">
        <div className="c-toolbar">
          <div className="c-search c-search-lg">
            <Search size={15} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search plate, reference, guard, notes" aria-label="Search" />
            {q && (
              <button className="icon-btn" onClick={() => setQ('')} aria-label="Clear search">
                <X size={14} />
              </button>
            )}
          </div>
          <select className="select c-select" value={period} onChange={(e) => setPeriod(e.target.value as Period)} aria-label="Period">
            <option value="today">Today</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="all">All time</option>
          </select>
          <select className="select c-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
            <option value="voided">Voided</option>
          </select>
          <select className="select c-select" value={type} onChange={(e) => setType(e.target.value)} aria-label="Violation type">
            <option value="all">All violations</option>
            {VIOLATION_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.short}
              </option>
            ))}
          </select>
          <select className="select c-select" value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Severity">
            <option value="all">Any severity</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select className="select c-select" value={area} onChange={(e) => setArea(e.target.value)} aria-label="Area">
            <option value="all">All areas</option>
            {AREAS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
          <select className="select c-select" value={guard} onChange={(e) => setGuard(e.target.value)} aria-label="Guard">
            <option value="all">All guards</option>
            {guards.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <select className="select c-select" value={notice} onChange={(e) => setNotice(e.target.value as NoticeFilter)} aria-label="Penalty notice">
            <option value="all">Any notice</option>
            <option value="printed">Notice printed</option>
            <option value="unprinted">Not printed</option>
            <option value="reprinted">Printed more than once</option>
          </select>
          <label className="c-check">
            <input type="checkbox" checked={offlineOnly} onChange={(e) => setOfflineOnly(e.target.checked)} /> Captured offline
          </label>
          <label className="c-check">
            <input type="checkbox" checked={mistakesOnly} onChange={(e) => setMistakesOnly(e.target.checked)} /> Mistake reports
          </label>
          {plate && (
            <span className="chip chip-accent">
              Plate {plate.replace(/\|/g, ' ')}
              <button className="c-chip-x" onClick={() => setPlate('')} aria-label="Clear plate filter">
                <X size={12} />
              </button>
            </span>
          )}
          {activeFilters > 0 && (
            <button className="btn btn-sm btn-ghost" onClick={reset}>
              Clear filters
            </button>
          )}
        </div>

        <div className="c-tablebar">
          {sel.size > 0 ? (
            <>
              <b>{sel.size} selected</b>
              <button className="btn btn-sm" disabled={busy} onClick={() => void bulk('reviewed')}>
                <CheckCheck size={14} /> Mark reviewed
              </button>
              <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void bulk('actioned')}>
                <Gavel size={14} /> Issue fines
              </button>
              <button className="btn btn-sm" disabled={busy} onClick={() => void bulk('dismissed')}>
                Dismiss
              </button>
              <button className="btn btn-sm" onClick={() => exportCsv(live.violations.filter((v) => sel.has(v.id)))}>
                <Download size={14} /> Export selected
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => setSel(new Set())}>
                Clear selection
              </button>
            </>
          ) : (
            <>
              <span className="faint">
                {filtered.length} record{filtered.length === 1 ? '' : 's'}
                {status === 'voided' ? ' · voided records are excluded from KPIs and fines' : ''}
              </span>
              <span style={{ flex: 1 }} />
              <button className="btn btn-sm" onClick={() => setFinesOpen(true)}>
                <ReceiptText size={14} /> Fine schedule
              </button>
              <button className="btn btn-sm" onClick={() => exportCsv(filtered)} disabled={!filtered.length}>
                <Download size={14} /> Export {filtered.length}
              </button>
            </>
          )}
        </div>

        <div className="c-table-wrap c-table-tall">
          <table className="c-table c-records">
            <thead>
              <tr>
                <th className="c-col-check">
                  <input
                    type="checkbox"
                    aria-label="Select page"
                    checked={allOnPage}
                    onChange={() =>
                      setSel((s) => {
                        const n = new Set(s);
                        rows.forEach((r) => (allOnPage ? n.delete(r.id) : n.add(r.id)));
                        return n;
                      })
                    }
                  />
                </th>
                <th>Ref</th>
                <Th k="plate">Plate</Th>
                <Th k="type">Violation</Th>
                <Th k="area">Where</Th>
                <Th k="guard">Guard</Th>
                <Th k="captured">Captured</Th>
                <Th k="status">Status</Th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="c-empty">
                    No records match these filters.{' '}
                    {activeFilters > 0 && (
                      <button className="btn btn-sm btn-ghost" onClick={reset}>
                        Clear filters
                      </button>
                    )}
                  </td>
                </tr>
              )}
              {rows.map((v) => (
                <tr key={v.id} className={`${sel.has(v.id) ? 'is-open ' : ''}${v.voided ? 'is-voided' : ''}${live.fresh.has(v.id) ? ' is-fresh' : ''}`} onClick={() => nav.openRecord(v.id)}>
                  <td className="c-col-check" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={sel.has(v.id)} onChange={() => toggle(v.id)} aria-label={`Select ${v.ref}`} />
                  </td>
                  <td className="mono faint" style={{ fontSize: 11.5 }}>
                    {v.ref}
                  </td>
                  <td>
                    <PlateChip plate={v.plate} />
                  </td>
                  <td>
                    <TypeCell v={v} />
                  </td>
                  <td className="c-ellipsis">{areaOf(v.location?.areaId)?.label.replace(/ \(.*\)$/, '') ?? '—'}</td>
                  <td className="c-ellipsis">{v.guardName}</td>
                  <td>
                    {fmtTime(v.capturedAt)}
                    <span className="faint" style={{ fontSize: 11 }}>
                      {' '}
                      {fmtDate(v.capturedAt)}
                    </span>
                  </td>
                  <td>
                    <div className="c-flags">
                      <StatusChip v={v} />
                      {v.capturedOffline && (
                        <span className="c-flag" title="Captured offline">
                          <WifiOff size={12} />
                        </span>
                      )}
                      {(v.edits?.length ?? 0) > 0 && (
                        <span className="c-flag" title={`Edited ${v.edits!.length}×`}>
                          <Pencil size={12} />
                        </span>
                      )}
                      {v.correction?.state === 'pending' && (
                        <span className="c-flag is-warn" title={`Guard reported a mistake: ${v.correction.reason}`}>
                          <Flag size={12} />
                        </span>
                      )}
                      {v.ai?.plateCheck?.ok && v.ai.plateCheck.agrees === false && (
                        <span className="c-flag is-warn" title="AI plate check differs from the guard's entry">
                          <Sparkles size={12} />
                        </span>
                      )}
                      {(v.notices?.length ?? 0) > 0 && (
                        <span className={'c-flag is-print'} title={noticeTitle(v)}>
                          <Printer size={12} />
                          {v.notices!.length > 1 ? <span className="c-flag-n">{v.notices!.length}</span> : null}
                        </span>
                      )}
                      {v.voided && (
                        <span className="c-flag is-danger" title={v.voidReason}>
                          <Ban size={12} />
                        </span>
                      )}
                    </div>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="c-row-actions">
                      <button className="icon-btn" title="View" onClick={() => nav.openRecord(v.id)}>
                        <Eye size={16} />
                      </button>
                      {!v.voided && (
                        <button className="icon-btn" title="Edit" onClick={() => nav.openRecord(v.id, true)}>
                          <Pencil size={16} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="c-pager">
            <button className="btn btn-sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <span className="faint">
              Page {page + 1} of {pages}
            </span>
            <button className="btn btn-sm" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>
        )}
      </section>
      {finesOpen && <FinesModal live={live} role={role} onClose={() => setFinesOpen(false)} />}
    </>
  );
}

function noticeTitle(v: Violation) {
  const ps = v.notices ?? [];
  return 'Notice printed ' + ps.length + '× · ' + fmtAed(ps[0]?.notice.fine) + ' · first by ' + (ps[0]?.by ?? '');
}
