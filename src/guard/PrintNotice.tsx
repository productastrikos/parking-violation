/**
 * Print the penalty notice for one violation — and the printer setup that
 * lives in Settings. The preview IS the printed picture (notice.ts), so the
 * guard sees exactly what the driver will get.
 */
import { useEffect, useMemo, useState } from 'react';
import { Receipt, Bluetooth, BluetoothConnected, CheckCircle2, Image as ImageIcon, Loader2, Printer, RotateCcw, Settings, AlertTriangle, Info, Unplug } from 'lucide-react';
import { queueOp, updateRecord, type LocalRecord } from './offline/db';
import { recordsChanged, syncNow, saveFines, useSyncStatus } from './offline/sync';
import { useFines, FINE_EDITOR_ROLES, MAX_FINE } from '../lib/fines';
import { VIOLATION_TYPES } from '../lib/api';
import { isIOS, uuid, deviceInfo, deviceLabel } from './offline/device';
import { buildNotice, asCopy, renderNotice, specimenNotice, plateText, fmtAed, type Notice } from '../lib/notice';
import {
  usePrinter, setPrinter, resetPrinterText, layoutOf, methodInfo, METHODS, printCanvas, pairBluetooth, forgetBluetooth, useBtConnected, recommendedMethod, type PrintMethod,
} from './print/printer';
import { Sheet } from './Sheet';

function usePreview(notice: Notice | null) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
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
  return { canvas, url };
}

type Job = { state: 'idle' } | { state: 'busy'; progress?: number } | { state: 'ok'; msg: string } | { state: 'err'; msg: string };

function errText(e: unknown) {
  const m = (e as Error)?.message || String(e);
  if (/User cancelled|chooser|No printer chosen/i.test(m)) return 'No printer chosen';
  if (/Bluetooth adapter not available|adapter/i.test(m)) return 'Bluetooth is off — turn it on and try again';
  if (/GATT|NetworkError/i.test(m)) return 'Could not reach the printer. Check it is on, charged and close by, then try again.';
  return m;
}

/* ── print one notice ─────────────────────────────────────────────────── */
export function PrintSheet({ rec, onClose, onSettings, onDone }: { rec: LocalRecord; onClose: () => void; onSettings: () => void; onDone: (msg: string) => void }) {
  const s = usePrinter();
  const btOn = useBtConnected();
  const fines = useFines(); // a supervisor's change shows up in the preview straight away
  // First print = the ORIGINAL (issues the fine, fixes its dates). Every later print repeats it as a DUPLICATE COPY.
  const notice = useMemo(
    () =>
      rec.firstNotice
        ? asCopy(rec.firstNotice, 'duplicate')
        : buildNotice({ ...rec, plate: rec.server?.plate ?? rec.plate, type: rec.server?.type ?? rec.type, photoCount: rec.photoKinds.length }, layoutOf(s), 'original'),
    [rec.id, rec.firstNotice, s.paper, s.authority, s.department, s.footer, s.payDays, fines],
  );
  const duplicate = notice.copy === 'duplicate';
  const { canvas, url } = usePreview(notice);
  const [job, setJob] = useState<Job>({ state: 'idle' });
  const info = methodInfo(s.method);
  const name = `Notice-${rec.ref}`;

  async function run(method: PrintMethod) {
    if (!canvas) return;
    setJob({ state: 'busy' });
    try {
      const msg = await printCanvas(canvas, name, method, (f) => setJob({ state: 'busy', progress: f }));
      // Accountability: every print goes to the control room (queued offline like the record itself).
      const at = Date.now();
      const dev = await deviceInfo();
      await queueOp({
        id: uuid(),
        kind: 'notice',
        violationId: rec.id,
        guardId: rec.guardId,
        reason: '',
        createdAt: at,
        state: 'pending',
        notice: { at, copy: duplicate ? 'duplicate' : 'original', method, printer: method === 'bluetooth' ? s.btName : undefined, deviceId: dev.deviceId, deviceLabel: await deviceLabel(), notice },
      });
      await updateRecord(rec.id, { printedAt: at, printCount: (rec.printCount ?? 0) + 1, firstNotice: rec.firstNotice ?? notice });
      recordsChanged();
      void syncNow();
      setJob({ state: 'ok', msg });
      navigator.vibrate?.(30);
      if (method === 'bluetooth') onDone(msg);
    } catch (e) {
      const msg = errText(e);
      setJob(msg === 'Cancelled' ? { state: 'idle' } : { state: 'err', msg });
    }
  }

  return (
    <Sheet title={duplicate ? 'Reprint penalty notice' : 'Print penalty notice'} onClose={onClose}>
      <div className="pn-paper">{url ? <img src={url} alt={`Penalty notice ${rec.ref} for ${plateText(notice.plate)}`} /> : <Loader2 size={22} className="spin" />}</div>
      {duplicate && (
        <div className="g-note g-note-info">
          <Info size={15} /> Printed before{rec.printedAt ? ` (${new Date(rec.printedAt).toLocaleString()})` : ''} — this copy is marked DUPLICATE COPY.
        </div>
      )}
      <div className="pn-via">
        <Printer size={16} />
        <span>
          {info.label}
          {s.method === 'bluetooth' && (s.btName ? ` · ${s.btName}${btOn ? ' (connected)' : ''}` : ' · not paired yet')} · {s.paper} mm
        </span>
        <button className="btn btn-ghost btn-sm" onClick={onSettings}>
          <Settings size={14} /> Change
        </button>
      </div>
      {!info.available && (
        <div className="g-note g-note-warn">
          <AlertTriangle size={15} /> {info.why}
        </div>
      )}
      {job.state === 'err' && (
        <div className="g-note g-note-danger" role="alert">
          <AlertTriangle size={15} /> {job.msg}
        </div>
      )}
      {job.state === 'ok' && (
        <div className="g-note g-note-ok" role="status">
          <CheckCircle2 size={15} /> {job.msg}
        </div>
      )}
      <button className="btn btn-primary btn-lg btn-block n-primary" disabled={!canvas || job.state === 'busy' || !info.available} onClick={() => void run(s.method)}>
        {job.state === 'busy' ? <Loader2 size={18} className="spin" /> : <Printer size={18} />}
        {job.state === 'busy' ? (job.progress != null ? `Printing… ${Math.round(job.progress * 100)}%` : 'Printing…') : job.state === 'ok' ? 'Print again' : duplicate ? 'Print duplicate' : 'Print notice'}
      </button>
      <div className="g-sheet-actions">
        {s.method !== 'share' && (
          <button className="btn" disabled={!canvas || job.state === 'busy'} onClick={() => void run('share')}>
            <ImageIcon size={15} /> Share image
          </button>
        )}
        {s.method !== 'system' && (
          <button className="btn" disabled={!canvas || job.state === 'busy'} onClick={() => void run('system')}>
            <Printer size={15} /> {isIOS() ? 'AirPrint' : 'System print'}
          </button>
        )}
      </div>
    </Sheet>
  );
}

/* ── Settings → Fine printer ──────────────────────────────────────────── */
export function PrinterSettingsSection({ officerName, officerId }: { officerName: string; officerId: string }) {
  const s = usePrinter();
  const btOn = useBtConnected();
  const [job, setJob] = useState<Job>({ state: 'idle' });
  const [showText, setShowText] = useState(false);
  const fines = useFines();
  const testNotice = useMemo(() => specimenNotice(officerName, officerId, layoutOf(s)), [officerName, officerId, s, fines]);
  const { canvas } = usePreview(testNotice);

  async function pair() {
    setJob({ state: 'busy' });
    try {
      const l = await pairBluetooth();
      setJob({ state: 'ok', msg: `Connected to ${l.device.name || 'the printer'}` });
    } catch (e) {
      setJob({ state: 'err', msg: errText(e) });
    }
  }
  async function test() {
    if (!canvas) return;
    setJob({ state: 'busy' });
    try {
      const msg = await printCanvas(canvas, 'Test-print', s.method, (f) => setJob({ state: 'busy', progress: f }));
      setJob({ state: 'ok', msg });
    } catch (e) {
      const msg = errText(e);
      setJob(msg === 'Cancelled' ? { state: 'idle' } : { state: 'err', msg });
    }
  }

  return (
    <>
      <div className="n-group-label">Fine printer</div>
      <section className="n-card n-group">
        <div className="n-row">
          <div className="n-row-icon">
            <Printer size={18} />
          </div>
          <div className="n-row-main">
            <div className="n-row-title">How this phone prints</div>
            <div className="n-row-sub">Recommended here: {methodInfo(recommendedMethod()).label}</div>
          </div>
        </div>
        <div className="pn-methods" role="radiogroup" aria-label="Printer connection">
          {METHODS.map((m) => {
            const i = methodInfo(m);
            return (
              <button key={m} role="radio" aria-checked={s.method === m} className={`pn-method${s.method === m ? ' is-on' : ''}${i.available ? '' : ' is-off'}`} onClick={() => (setPrinter({ method: m }), setJob({ state: 'idle' }))}>
                <span className="pn-radio" aria-hidden />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="pn-method-title">{i.label}</span>
                  <span className="pn-method-sub">{i.available ? i.sub : i.why}</span>
                </span>
              </button>
            );
          })}
        </div>

        {s.method === 'bluetooth' && methodInfo('bluetooth').available && (
          <div className="n-row">
            <div className="n-row-icon">{btOn ? <BluetoothConnected size={18} /> : <Bluetooth size={18} />}</div>
            <div className="n-row-main">
              <div className="n-row-title">{s.btName ?? 'No printer paired'}</div>
              <div className="n-row-sub">{s.btName ? (btOn ? 'Connected' : 'Reconnects when you print') : 'Turn the printer on, then pair'}</div>
            </div>
            {s.btName && (
              <button className="icon-btn" onClick={forgetBluetooth} aria-label="Forget printer">
                <Unplug size={17} />
              </button>
            )}
            <button className="btn" onClick={() => void pair()} disabled={job.state === 'busy'}>
              {s.btName ? 'Change' : 'Pair'}
            </button>
          </div>
        )}
        {s.method === 'rawbt' && (
          <div className="g-note g-note-info" style={{ margin: '0 14px 14px' }}>
            <Info size={15} /> Install <b>RawBT</b> from the Play Store, select your printer in it once, then print from here. If RawBT is missing, Android opens the Play Store.
          </div>
        )}
        {s.method === 'share' && (
          <div className="g-note g-note-info" style={{ margin: '0 14px 14px' }}>
            <Info size={15} /> Printing opens the share sheet with the notice image — pick your printer's app (the one that came with the printer){isIOS() ? ', or Print for AirPrint' : ''}.
          </div>
        )}

        <div className="n-row">
          <div className="n-row-main">
            <div className="n-row-title">Paper width</div>
          </div>
        </div>
        <div className="n-segment n-segment-in">
          {([58, 80] as const).map((w) => (
            <button key={w} className={s.paper === w ? 'is-on' : ''} onClick={() => setPrinter({ paper: w })}>
              {w} mm{w === 58 ? ' · mini' : ''}
            </button>
          ))}
        </div>

        <label className="n-row" style={{ cursor: 'pointer' }}>
          <div className="n-row-main">
            <div className="n-row-title">Offer to print after saving</div>
            <div className="n-row-sub">Opens the print screen for each new violation</div>
          </div>
          <input type="checkbox" className="pn-switch" checked={s.offerAfterSave} onChange={(e) => setPrinter({ offerAfterSave: e.target.checked })} />
        </label>

        <button className="n-row pn-row-btn" onClick={() => setShowText((v) => !v)}>
          <div className="n-row-main">
            <div className="n-row-title">Notice header & terms</div>
            <div className="n-row-sub">{s.authority}</div>
          </div>
          <span className="faint" style={{ fontSize: 12 }}>
            {showText ? 'Hide' : 'Edit'}
          </span>
        </button>
        {showText && (
          <div className="n-row n-row-col">
            <label className="pn-field">
              Issuing authority
              <input className="input" value={s.authority} onChange={(e) => setPrinter({ authority: e.target.value })} />
            </label>
            <label className="pn-field">
              Department / section
              <input className="input" value={s.department} onChange={(e) => setPrinter({ department: e.target.value })} />
            </label>
            <label className="pn-field">
              Days to pay
              <input className="input" type="number" min={1} max={365} inputMode="numeric" value={s.payDays} onChange={(e) => setPrinter({ payDays: Math.max(1, Math.min(365, Number(e.target.value) || 30)) })} />
            </label>
            <label className="pn-field">
              Payment & appeal terms
              <textarea className="textarea" value={s.footer} onChange={(e) => setPrinter({ footer: e.target.value })} />
            </label>
            <button className="btn btn-sm" onClick={resetPrinterText}>
              <RotateCcw size={14} /> Restore defaults
            </button>
            <p className="faint" style={{ fontSize: 12, margin: 0 }}>
              Fine amounts and offence codes are sample values for this demo.
            </p>
          </div>
        )}

        {job.state === 'err' && (
          <div className="g-note g-note-danger" style={{ margin: '12px 14px 0' }} role="alert">
            <AlertTriangle size={15} /> {job.msg}
          </div>
        )}
        {job.state === 'ok' && (
          <div className="g-note g-note-ok" style={{ margin: '12px 14px 0' }} role="status">
            <CheckCircle2 size={15} /> {job.msg}
          </div>
        )}
        <div style={{ padding: 14 }}>
          <button className="btn btn-lg btn-block" disabled={!canvas || job.state === 'busy' || !methodInfo(s.method).available} onClick={() => void test()}>
            {job.state === 'busy' ? <Loader2 size={17} className="spin" /> : <Printer size={17} />}
            {job.state === 'busy' && job.progress != null ? `Printing… ${Math.round(job.progress * 100)}%` : 'Test print'}
          </button>
        </div>
      </section>
    </>
  );
}


/* ── Settings → Fine schedule (supervisors change it; guards see it) ──── */
export function FineScheduleSection({ role }: { role: string }) {
  const f = useFines();
  const sync = useSyncStatus();
  const canEdit = FINE_EDITOR_ROLES.includes(role);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [job, setJob] = useState<Job>({ state: 'idle' });

  const changes: Record<string, number | null> = {};
  for (const [id, raw] of Object.entries(draft)) {
    const to = raw.trim() === '' ? null : Number(raw);
    if (to !== (f.schedule[id]?.fine ?? null)) changes[id] = to;
  }
  const n = Object.keys(changes).length;
  const invalid = Object.values(changes).some((x) => x !== null && (!Number.isFinite(x) || x < 0 || x > MAX_FINE));

  async function save() {
    setJob({ state: 'busy' });
    try {
      await saveFines(changes, reason.trim());
      setDraft({});
      setReason('');
      setJob({ state: 'ok', msg: `${n} fine${n === 1 ? '' : 's'} updated — every phone and the dashboard use the new amounts now` });
    } catch (e) {
      setJob({ state: 'err', msg: (e as Error).message });
    }
  }

  return (
    <>
      <div className="n-group-label">Fine schedule</div>
      <section className="n-card n-group">
        <button className="n-row pn-row-btn" onClick={() => setOpen((x) => !x)}>
          <div className="n-row-icon">
            <Receipt size={18} />
          </div>
          <div className="n-row-main">
            <div className="n-row-title">{canEdit ? 'Fine amounts (you can change them)' : 'Fine amounts'}</div>
            <div className="n-row-sub">{f.updatedAt ? `Changed ${new Date(f.updatedAt).toLocaleString()} by ${f.updatedBy}` : 'Sample amounts'}</div>
          </div>
          <span className="faint" style={{ fontSize: 12 }}>
            {open ? 'Hide' : canEdit ? 'Edit' : 'View'}
          </span>
        </button>
        {open && (
          <>
            {VIOLATION_TYPES.map((t) => {
              const cur = f.schedule[t.id]?.fine ?? null;
              return (
                <div key={t.id} className={`n-row pn-fine${t.id in changes ? ' is-changed' : ''}`}>
                  <div className="n-row-main">
                    <div className="n-row-title" style={{ fontSize: 13.5 }}>
                      {t.short}
                    </div>
                    <div className="n-row-sub mono">{f.schedule[t.id]?.code}</div>
                  </div>
                  {canEdit ? (
                    <div className="pn-fine-input">
                      <span>AED</span>
                      <input
                        className="input"
                        inputMode="decimal"
                        value={draft[t.id] ?? (cur == null ? '' : String(cur))}
                        placeholder="assessed"
                        aria-label={`Fine for ${t.label}`}
                        onChange={(e) => (setDraft((d) => ({ ...d, [t.id]: e.target.value.replace(/[^\d.]/g, '') })), setJob({ state: 'idle' }))}
                      />
                    </div>
                  ) : (
                    <div className="n-row-value">{fmtAed(cur)}</div>
                  )}
                </div>
              );
            })}
            {canEdit && (
              <div className="n-row n-row-col">
                <label className="pn-field">
                  Reason for the change (required)
                  <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. New council fee schedule" />
                </label>
                {invalid && <div className="form-error">A fine must be between AED 0 and {MAX_FINE.toLocaleString('en-US')}.</div>}
                {sync.online === false && (
                  <div className="g-note g-note-warn">
                    <AlertTriangle size={15} /> No connection — fines can only be changed online.
                  </div>
                )}
                {job.state === 'err' && (
                  <div className="g-note g-note-danger" role="alert">
                    <AlertTriangle size={15} /> {job.msg}
                  </div>
                )}
                {job.state === 'ok' && (
                  <div className="g-note g-note-ok" role="status">
                    <CheckCircle2 size={15} /> {job.msg}
                  </div>
                )}
                <button className="btn btn-primary btn-block" disabled={!n || invalid || reason.trim().length < 3 || job.state === 'busy' || sync.online === false} onClick={() => void save()}>
                  {job.state === 'busy' ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />} Save {n || ''} change{n === 1 ? '' : 's'}
                </button>
                <p className="faint" style={{ fontSize: 12, margin: 0 }}>
                  Applies to notices printed from now on. Notices already handed out keep their amount. Every change is logged with your name.
                </p>
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}
