/**
 * Penalty notices on the dashboard — visibility and accountability for what
 * the guards hand to drivers:
 *
 *   • per record: issued or not, the amount, pay-by date, and EVERY print
 *     (original, duplicates from the phone, office copies) with who, when,
 *     which device and printer;
 *   • view any of them exactly as printed (re-drawn from the stored snapshot);
 *   • print an office copy (logged like any other print), or issue the notice
 *     from the office when none was printed in the field;
 *   • the fine schedule: everyone sees it, an admin (or supervisor) changes it
 *     with a reason — every change is kept.
 */
import { useEffect, useMemo, useState } from 'react';
import { Download, Eye, FileText, History, Loader2, Pencil, Printer, ReceiptText, Smartphone, Monitor, AlertTriangle } from 'lucide-react';
import { VIOLATION_TYPES, fmtDate, fmtDateTime, type Violation, type NoticePrint } from '../lib/api';
import { asCopy, buildNotice, downloadImage, fmtAed, printImage, renderNotice, DEFAULT_LAYOUT, type Notice, type NoticeLayout } from '../lib/notice';
import { useFines, FINE_EDITOR_ROLES, MAX_FINE } from '../lib/fines';
import type { Live } from './useLive';
import { Modal, useToast } from './parts';

export const METHOD_LABEL: Record<string, string> = {
  bluetooth: 'Bluetooth printer',
  rawbt: 'RawBT print service',
  share: 'Shared to printer app',
  system: 'System print / AirPrint',
  browser: 'Office printer (browser)',
};
const COPY_LABEL = { original: 'Original', duplicate: 'Duplicate', office: 'Office copy' } as const;

/** The layout guards are printing with now (latest notice anywhere), so office-issued notices match. */
function currentLayout(all: Violation[]): NoticeLayout {
  let best: NoticePrint | null = null;
  for (const v of all) for (const p of v.notices ?? []) if (p.surface === 'app' && (!best || p.at > best.at)) best = p;
  return best?.notice.layout ?? DEFAULT_LAYOUT;
}

const sourceOf = (v: Violation) => ({ ...v, photoCount: v.photos.length || 1 });

export function NoticeSection({ v, live }: { v: Violation; live: Live }) {
  const [view, setView] = useState<{ notice: Notice; title: string; log?: NoticePrint } | null>(null);
  const prints = v.notices ?? [];
  const first = prints[0];
  const dup = prints.filter((p) => p.copy === 'duplicate').length;
  const office = prints.filter((p) => p.copy === 'office').length;

  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 10 }}>
        <ReceiptText size={12} style={{ verticalAlign: '-1px' }} /> Penalty notice
      </div>
      {first ? (
        <div className="c-notice">
          <div className="c-notice-head">
            <div className="c-notice-amount">{fmtAed(first.notice.fine)}</div>
            <span className="chip chip-success">
              <Printer size={11} /> Issued
            </span>
          </div>
          <div className="c-notice-meta">
            <div>
              <b>{first.notice.ref}</b> · code {first.notice.code || '—'} · pay by <b>{fmtDate(first.notice.dueAt)}</b>
            </div>
            <div className="faint">
              Handed over {fmtDateTime(first.at)} by {first.by}
              {first.surface === 'app' ? ` · ${first.deviceLabel ?? 'phone'}` : ' · from the dashboard'}
              {first.printer ? ` · ${first.printer}` : ''}
            </div>
            <div className="faint">
              Printed {prints.length}× {dup ? `· ${dup} duplicate${dup > 1 ? 's' : ''}` : ''} {office ? `· ${office} office cop${office > 1 ? 'ies' : 'y'}` : ''}
            </div>
          </div>
          {v.voided && (
            <div className="c-callout tone-danger" style={{ marginTop: 10 }}>
              <AlertTriangle size={15} />
              <div>The driver holds a printed notice for this voided record — cancel the fine with them.</div>
            </div>
          )}
          <div className="c-notice-actions">
            <button className="btn btn-sm" onClick={() => setView({ notice: first.notice, title: `${first.notice.ref} — as handed to the driver`, log: first })}>
              <Eye size={14} /> View notice
            </button>
            <button className="btn btn-sm" onClick={() => setView({ notice: asCopy(first.notice, 'office'), title: `${first.notice.ref} — office copy` })}>
              <Printer size={14} /> Office copy
            </button>
          </div>
          <ol className="c-print-log">
            {[...prints].reverse().map((p) => (
              <li key={p.id}>
                <span className={`c-print-ico${p.copy === 'original' ? ' is-orig' : ''}`}>{p.surface === 'app' ? <Smartphone size={12} /> : <Monitor size={12} />}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b>
                    #{p.no} {COPY_LABEL[p.copy]}
                  </b>{' '}
                  <span className="faint">
                    · {fmtDateTime(p.at)} · {p.by}
                  </span>
                  <div className="faint" style={{ fontSize: 12 }}>
                    {METHOD_LABEL[p.method] ?? p.method}
                    {p.printer ? ` · ${p.printer}` : ''}
                    {p.deviceLabel ? ` · ${p.deviceLabel}` : ''}
                    {p.receivedAt - p.at > 120_000 ? ` · printed offline, reported ${fmtDateTime(p.receivedAt)}` : ''}
                  </div>
                </div>
                <button className="icon-btn" title="View this copy" onClick={() => setView({ notice: p.notice, title: `${p.notice.ref} — print #${p.no}`, log: p })}>
                  <Eye size={15} />
                </button>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <div className="c-notice is-empty">
          <div className="muted">
            <FileText size={15} style={{ verticalAlign: '-3px' }} /> No notice printed yet{v.voided ? ' — record voided' : ' — the guard prints it on the spot'}.
          </div>
          <div className="c-notice-actions">
            <button className="btn btn-sm" onClick={() => setView({ notice: buildNotice(sourceOf(v), currentLayout(live.violations), 'preview'), title: `${v.ref} — preview (not issued)` })}>
              <Eye size={14} /> Preview
            </button>
            {!v.voided && (
              <button className="btn btn-sm" onClick={() => setView({ notice: buildNotice(sourceOf(v), currentLayout(live.violations), 'original'), title: `${v.ref} — issue from the office` })}>
                <Printer size={14} /> Issue &amp; print
              </button>
            )}
          </div>
        </div>
      )}
      {view && <NoticeViewer v={v} live={live} notice={view.notice} title={view.title} log={view.log} onClose={() => setView(null)} />}
    </div>
  );
}

function NoticeViewer({ v, live, notice, title, log, onClose }: { v: Violation; live: Live; notice: Notice; title: string; log?: NoticePrint; onClose: () => void }) {
  const toast = useToast();
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    void renderNotice(notice).then((c) => {
      if (!alive) return;
      setCanvas(c);
      setUrl(c.toDataURL('image/png'));
    });
    return () => {
      alive = false;
    };
  }, [notice]);

  // Viewing is free; anything that puts a notice on paper is logged first.
  const printable = notice.copy === 'office' || (notice.copy === 'original' && !(v.notices?.length ?? 0));
  async function print() {
    if (!canvas) return;
    setBusy(true);
    try {
      await live.logNoticePrint(v.id, { notice, method: 'browser' });
      await printImage(canvas, notice.layout.paper === 80 ? 76 : 54);
      toast(notice.copy === 'original' ? `${notice.ref}: notice issued — fine recorded` : 'Office copy printed and logged');
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="c-notice-view">
        <div className="c-notice-paper">{url ? <img src={url} alt={`Penalty notice ${notice.ref}`} /> : <Loader2 size={20} className="spin" />}</div>
        <div className="c-notice-side">
          <dl className="c-dl">
            <dt>Notice No.</dt>
            <dd className="mono">{notice.ref}</dd>
            <dt>Fine</dt>
            <dd>
              <b>{fmtAed(notice.fine)}</b> · code {notice.code || '—'}
            </dd>
            <dt>Issued</dt>
            <dd>{fmtDateTime(notice.issuedAt)}</dd>
            <dt>Pay by</dt>
            <dd>{fmtDate(notice.dueAt)}</dd>
            <dt>Authority</dt>
            <dd>{notice.layout.authority}</dd>
            {log && (
              <>
                <dt>Printed</dt>
                <dd>
                  #{log.no} {COPY_LABEL[log.copy]} · {fmtDateTime(log.at)}
                  <div className="faint">
                    {log.by} · {METHOD_LABEL[log.method] ?? log.method}
                    {log.printer ? ` · ${log.printer}` : ''}
                    {log.deviceLabel ? ` · ${log.deviceLabel}` : ''}
                  </div>
                </dd>
              </>
            )}
          </dl>
          {notice.copy === 'preview' && <p className="faint">Preview with the current fine schedule — nothing is issued or logged.</p>}
          {notice.copy === 'original' && printable && <p className="faint">Printing issues the notice from the office: the record moves to Fine issued and the print is logged under your name.</p>}
          {notice.copy === 'office' && <p className="faint">Same notice, numbers and dates as the original, marked OFFICE COPY. The print is logged under your name.</p>}
          {log && <p className="faint">Re-drawn from what was stored at print time — exactly what was on the paper.</p>}
          <div className="c-notice-actions">
            {printable && (
              <button className="btn btn-primary" disabled={!canvas || busy} onClick={() => void print()}>
                {busy ? <Loader2 size={15} className="spin" /> : <Printer size={15} />} {notice.copy === 'original' ? 'Issue & print' : 'Print office copy'}
              </button>
            )}
            <button className="btn" disabled={!canvas} onClick={() => canvas && downloadImage(canvas, `Notice-${notice.ref}${log ? `-print${log.no}` : ''}`)}>
              <Download size={15} /> PNG
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ── fine schedule ────────────────────────────────────────────────────── */
export function FinesModal({ live, role, onClose }: { live: Live; role: string; onClose: () => void }) {
  const toast = useToast();
  const f = useFines();
  const canEdit = FINE_EDITOR_ROLES.includes(role);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [showLog, setShowLog] = useState(false);
  useEffect(() => void live.reloadFines().catch(() => {}), [live]);

  const changes = useMemo(() => {
    const out: Record<string, number | null> = {};
    for (const [id, raw] of Object.entries(draft)) {
      const to = raw.trim() === '' ? null : Number(raw);
      if (to !== (f.schedule[id]?.fine ?? null)) out[id] = to;
    }
    return out;
  }, [draft, f]);
  const n = Object.keys(changes).length;
  const invalid = Object.values(changes).some((x) => x !== null && (!Number.isFinite(x) || x < 0 || x > MAX_FINE));

  async function save() {
    setBusy(true);
    try {
      await live.saveFines(changes, reason);
      toast(`${n} fine${n === 1 ? '' : 's'} updated — phones use the new amounts now`);
      setDraft({});
      setReason('');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Fine schedule" onClose={onClose} wide>
      <p className="muted" style={{ marginTop: 0 }}>
        The amount printed on each new penalty notice. Changes reach every phone at once (offline phones on their next connection). Notices already printed keep their amount.
        {f.updatedAt ? ` Last changed ${fmtDateTime(f.updatedAt)} by ${f.updatedBy}.` : ' Sample amounts — not changed yet.'}
      </p>
      <div className="c-table-wrap">
        <table className="c-table c-fines">
          <thead>
            <tr>
              <th>Code</th>
              <th>Violation</th>
              <th className="num">Fine (AED)</th>
            </tr>
          </thead>
          <tbody>
            {VIOLATION_TYPES.map((t) => {
              const cur = f.schedule[t.id]?.fine ?? null;
              const val = draft[t.id] ?? (cur == null ? '' : String(cur));
              const changed = t.id in changes;
              return (
                <tr key={t.id} className={changed ? 'is-open' : ''}>
                  <td className="mono faint">{f.schedule[t.id]?.code}</td>
                  <td>{t.label}</td>
                  <td className="num">
                    {canEdit ? (
                      <input
                        className="input c-fine-input"
                        inputMode="decimal"
                        value={val}
                        placeholder="assessed later"
                        aria-label={`Fine for ${t.label}`}
                        onChange={(e) => setDraft((d) => ({ ...d, [t.id]: e.target.value.replace(/[^\d.]/g, '') }))}
                      />
                    ) : (
                      fmtAed(cur)
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canEdit ? (
        <div className="c-fines-save">
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for the change (required), e.g. Council resolution 14/2026" aria-label="Reason" />
          <button className="btn btn-primary" disabled={!n || invalid || reason.trim().length < 3 || busy} onClick={() => void save()}>
            {busy ? <Loader2 size={15} className="spin" /> : <Pencil size={15} />} Save {n || ''} change{n === 1 ? '' : 's'}
          </button>
        </div>
      ) : (
        <p className="faint">Only supervisors and admins change fines.</p>
      )}
      {invalid && <p className="form-error">A fine must be between AED 0 and {MAX_FINE.toLocaleString('en-US')}.</p>}
      {(f.history?.length ?? 0) > 0 && (
        <div style={{ marginTop: 14 }}>
          <button className="btn btn-sm btn-ghost" onClick={() => setShowLog((x) => !x)}>
            <History size={14} /> {showLog ? 'Hide' : 'Show'} change log ({f.history!.length})
          </button>
          {showLog && (
            <ol className="c-print-log">
              {f.history!.map((h, i) => (
                <li key={i}>
                  <span className="c-print-ico">
                    <Pencil size={12} />
                  </span>
                  <div>
                    <b>{h.by}</b> <span className="faint">({h.role}) · {fmtDateTime(h.at)} · "{h.reason}"</span>
                    <div className="faint" style={{ fontSize: 12 }}>
                      {h.changes.map((c) => `${VIOLATION_TYPES.find((t) => t.id === c.typeId)?.short ?? c.typeId}: ${fmtAed(c.from)} → ${fmtAed(c.to)}`).join(' · ')}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </Modal>
  );
}
