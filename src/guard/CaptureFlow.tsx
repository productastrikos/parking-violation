/**
 * Record one violation, online or not — or correct one that has not been
 * uploaded yet. About 30 seconds for a guard:
 *
 *   ① photo of the vehicle (evidence)         — required, phone camera app
 *   ② scan the plate (live camera, read on the phone) — or a plate photo
 *   ③ plate: emirate · code · number — the guard confirms; warnings for repeat
 *      offenders (cached watchlist, works offline) and for a plate this phone
 *      recorded in the last 30 minutes
 *   ④ what the violation is                    — one tap on a grid
 *   ⑤ where: GPS (or the labelled DEMO position) + area + landmark
 *   ⑥ notes (optional)                          → Save
 *
 * Save writes to the phone's database and returns at once — it never waits for
 * the network. A DRAFT is kept while the form is open, so a phone call, a
 * killed app or a flat battery never loses a half-filled violation.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowLeft, Camera, CheckCircle2, Crosshair, Loader2, MapPin, RefreshCw, ScanLine, Save, AlertTriangle, Clock, History, Siren, FlaskConical, RotateCcw } from 'lucide-react';
import { VIOLATION_TYPES, AREAS, EMIRATES, typeOf, areaOf, fmtDateTime, fmtTime, type User, type Severity } from '../lib/api';
import { TypeIcon } from '../lib/ui';
import { saveRecord, replaceUnsynced, nextSeq, photosFor, allRecords, getDraft, saveDraft, clearDraft, type LocalRecord } from './offline/db';
import { deviceInfo, deviceLabel, uuid } from './offline/device';
import { processPhoto } from './offline/photo';
import { readPlate, type PlateRead } from './offline/plateOcr';
import { getStatus, getFieldPack, subscribePack } from './offline/sync';
import { useGps, setGpsMode } from './offline/location';
import { plateHistory, plateKey } from '../../shared/intel.js';
import PlateScanner, { type ScanResult } from './PlateScanner';
import { Confirm } from './Sheet';

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

interface Shot {
  file: Blob;
  url: string;
  at: number;
  /** Already carries the evidence stamp (a stored photo being edited) — do not stamp twice. */
  stamped?: boolean;
}
const shotOf = (file: Blob, at = Date.now(), stamped = false): Shot => ({ file, url: URL.createObjectURL(file), at, stamped });

const usePack = () => useSyncExternalStore(subscribePack, getFieldPack);

export default function CaptureFlow({ user, editing, onCancel, onSaved }: { user: User; editing?: LocalRecord | null; onCancel: () => void; onSaved: (online: boolean | null, edited: boolean, id?: string) => void }) {
  const [vehicle, setVehicle] = useState<Shot | null>(null);
  const [plateShot, setPlateShot] = useState<Shot | null>(null);
  const [emirate, setEmirate] = useState(editing?.plate.emirate ?? 'AD');
  const [code, setCode] = useState(editing?.plate.code ?? '');
  const [number, setNumber] = useState(editing?.plate.number ?? '');
  const [plateSource, setPlateSource] = useState<'ocr' | 'manual'>(editing?.plate.source ?? 'manual');
  // 'suggest': the reader found something plate-like but could not confirm it — shown, never filled in.
  const [ocr, setOcr] = useState<{ state: 'idle' | 'reading' | 'done' | 'suggest' | 'failed'; msg?: string; confidence?: number; s?: PlateRead }>({ state: 'idle' });
  const [type, setType] = useState<string>(editing?.type ?? '');
  const [areaId, setAreaId] = useState(editing?.location.areaId ?? user.area ?? '');
  const [areaTouched, setAreaTouched] = useState(Boolean(editing));
  const [landmark, setLandmark] = useState(editing?.location.landmark ?? '');
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [restored, setRestored] = useState(false);
  const [recent, setRecent] = useState<LocalRecord[]>([]);
  const { gps, retry } = useGps(user.id, user.area);
  const pack = usePack();
  const vehicleInput = useRef<HTMLInputElement>(null);
  const plateInput = useRef<HTMLInputElement>(null);
  const openedAt = useMemo(() => editing?.capturedAt ?? Date.now(), [editing]);
  const ready = useRef(false);

  /* Load: the record being edited (with its photos), else a saved draft. */
  useEffect(() => {
    let alive = true;
    (async () => {
      setRecent((await allRecords()).filter((r) => Date.now() - r.capturedAt < 30 * 60_000 && r.id !== editing?.id));
      if (editing) {
        const ps = await photosFor(editing.id);
        if (!alive) return;
        for (const p of ps) {
          const s = shotOf(new Blob([p.buf], { type: p.type }), editing.capturedAt, p.kind === 'vehicle');
          if (p.kind === 'vehicle') setVehicle(s);
          else setPlateShot(s);
        }
      } else {
        const d = await getDraft(user.id);
        if (alive && d && !d.editingId && Date.now() - d.savedAt < 24 * 3_600_000) {
          const f = d.fields as Record<string, string>;
          setEmirate(f.emirate ?? 'AD');
          setCode(f.code ?? '');
          setNumber(f.number ?? '');
          setPlateSource((f.plateSource as 'ocr' | 'manual') ?? 'manual');
          setType(f.type ?? '');
          if (f.areaId) {
            setAreaId(f.areaId);
            setAreaTouched(true);
          }
          setLandmark(f.landmark ?? '');
          setNotes(f.notes ?? '');
          for (const p of d.photos) {
            const s = shotOf(new Blob([p.buf], { type: p.type }), p.at);
            if (p.kind === 'vehicle') setVehicle(s);
            else setPlateShot(s);
          }
          setRestored(true);
        }
      }
      ready.current = true;
    })();
    return () => {
      alive = false;
    };
  }, [editing, user.id]);

  const hasContent = Boolean(vehicle || plateShot || number || code || type || landmark || notes);

  /* Autosave the draft (new records only — an edit's original stays on the phone anyway). */
  useEffect(() => {
    if (!ready.current || editing) return;
    if (!hasContent) return;
    const t = setTimeout(async () => {
      const photos = [];
      if (vehicle) photos.push({ kind: 'vehicle' as const, buf: await vehicle.file.arrayBuffer(), type: vehicle.file.type || 'image/jpeg', at: vehicle.at });
      if (plateShot) photos.push({ kind: 'plate' as const, buf: await plateShot.file.arrayBuffer(), type: plateShot.file.type || 'image/jpeg', at: plateShot.at });
      await saveDraft({ userId: user.id, fields: { emirate, code, number, plateSource, type, areaId: areaTouched ? areaId : '', landmark, notes }, photos, savedAt: Date.now() });
    }, 700);
    return () => clearTimeout(t);
  }, [vehicle, plateShot, emirate, code, number, plateSource, type, areaId, areaTouched, landmark, notes, user.id, editing, hasContent]);

  // Free preview object URLs when they change or the form closes.
  useEffect(() => () => void (vehicle && URL.revokeObjectURL(vehicle.url)), [vehicle]);
  useEffect(() => () => void (plateShot && URL.revokeObjectURL(plateShot.url)), [plateShot]);

  // With a GPS fix, preselect the nearest area (unless the guard already chose one).
  useEffect(() => {
    if (gps.state !== 'fixed' || areaTouched) return;
    const nearest = AREAS.map((a) => ({ a, d: distanceKm(gps.fix, a) })).sort((x, y) => x.d - y.d)[0];
    if (nearest && nearest.d < 6) setAreaId(nearest.a.id);
  }, [gps, areaTouched]);

  const applyPlate = useCallback((r: PlateRead) => {
    setNumber(r.number);
    setCode(r.code);
    if (r.emirate) setEmirate(r.emirate);
    setPlateSource('ocr');
    setOcr({ state: 'done', confidence: r.confidence });
  }, []);

  const runOcr = useCallback(async (file: Blob) => {
    setOcr({ state: 'reading' });
    try {
      const r = await readPlate(file);
      if (r.verdict === 'read') applyPlate(r);
      else if (r.verdict === 'unsure') setOcr({ state: 'suggest', s: r });
      else setOcr({ state: 'failed', msg: 'No plate number found in that photo — type it below, or scan again closer and straight on' });
    } catch {
      setOcr({ state: 'failed', msg: 'Plate reader is not available on this phone right now — type the plate' });
    }
  }, [applyPlate]);

  function pick(kind: 'vehicle' | 'plate', file?: File | null) {
    if (!file) return;
    if (kind === 'vehicle') setVehicle(shotOf(file));
    else {
      setPlateShot(shotOf(file));
      void runOcr(file);
    }
  }

  function openPlate() {
    if (typeof navigator.mediaDevices?.getUserMedia === 'function') setScanning(true);
    else plateInput.current?.click();
  }

  function onScan(r: ScanResult) {
    setScanning(false);
    setPlateShot(shotOf(r.photo));
    // The guard saw the reading next to the live plate and tapped "Use" — that is the confirmation.
    if (r.number) applyPlate(r);
    else setOcr({ state: 'failed', msg: 'No plate number read — type it below' });
  }

  const capturedAt = editing?.capturedAt ?? vehicle?.at ?? openedAt;
  const t = typeOf(type);
  const plate = { emirate, code, number, source: plateSource };
  const offender = number ? plateHistory(pack?.watchlist ?? [], plate) : null;
  const sameRecently = number ? recent.find((r) => plateKey(r.plate) === plateKey(plate)) : null;

  async function save() {
    setError(null);
    if (!vehicle) return setError('Take a photo of the vehicle first');
    if (!number && !code) return setError('Enter the plate number (or scan it)');
    if (!type) return setError('Choose what the violation is');
    if (type === 'other' && notes.trim().length < 3) return setError('For "Other", describe the violation in the notes');
    if (!areaId && gps.state !== 'fixed') return setError('Choose the area — there is no GPS fix');
    setSaving(true);
    try {
      let savedId = editing?.id;
      const dev = await deviceInfo();
      const label = await deviceLabel();
      const fix = gps.state === 'fixed' ? gps.fix : editing?.location.gps ?? null;
      const area = areaOf(areaId);
      const stamp = [
        `${fmtDateTime(capturedAt)} · ${t?.short ?? ''}`,
        `${area?.label ?? ''}${landmark ? ` · ${landmark}` : ''}${fix ? ` · ${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)}${fix.demo ? ' (demo)' : ''}` : ''}`,
        `${user.name} · Park Patrol`,
      ];
      const v = await processPhoto(vehicle.file, vehicle.stamped ? undefined : stamp);
      const p = plateShot ? await processPhoto(plateShot.file) : null;
      URL.revokeObjectURL(v.previewUrl);
      if (p) URL.revokeObjectURL(p.previewUrl);
      const online = getStatus().online;
      const photos = [{ kind: 'vehicle' as const, buf: v.buf, type: v.type }, ...(p ? [{ kind: 'plate' as const, buf: p.buf, type: p.type }] : [])];
      const plateOut = { emirate, code: code.trim().toUpperCase(), number: number.replace(/\D/g, ''), raw: `${code} ${number}`.trim(), source: plateSource, confidence: plateSource === 'ocr' ? ocr.confidence : undefined };

      if (editing) {
        await replaceUnsynced(
          { ...editing, type, severity: (t?.severity ?? 'medium') as Severity, plate: plateOut, location: { areaId, landmark: landmark.trim(), gps: fix }, notes: notes.trim(), thumb: v.thumb, photoKinds: p ? ['vehicle', 'plate'] : ['vehicle'], syncState: 'pending', lastError: undefined, editedAt: Date.now() },
          photos,
        );
      } else {
        const seq = await nextSeq();
        const d = new Date(capturedAt);
        const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
        const rec: LocalRecord = {
          id: uuid(),
          ref: `PV-${ymd}-${dev.deviceId.slice(0, 4).toUpperCase()}-${String(seq).padStart(3, '0')}`,
          type,
          severity: (t?.severity ?? 'medium') as Severity,
          plate: plateOut,
          location: { areaId, landmark: landmark.trim(), gps: fix },
          notes: notes.trim(),
          guardId: user.id,
          guardName: user.name,
          deviceId: dev.deviceId,
          deviceLabel: label,
          capturedAt,
          // Only claim "captured offline" when the phone actually knew it had no connection.
          capturedOffline: online === false,
          thumb: v.thumb,
          photoKinds: p ? ['vehicle', 'plate'] : ['vehicle'],
          syncState: 'pending',
          attempts: 0,
        };
        await saveRecord(rec, photos);
        savedId = rec.id;
        await clearDraft(user.id);
      }
      navigator.vibrate?.([30, 40, 30]);
      onSaved(online, Boolean(editing), savedId);
    } catch (e) {
      setError(`Could not save: ${(e as Error).message}`);
      setSaving(false);
    }
  }

  async function discardDraft() {
    await clearDraft(user.id);
    setVehicle(null);
    setPlateShot(null);
    setEmirate('AD');
    setCode('');
    setNumber('');
    setPlateSource('manual');
    setOcr({ state: 'idle' });
    setType('');
    setAreaId(user.area ?? '');
    setAreaTouched(false);
    setLandmark('');
    setNotes('');
    setRestored(false);
  }

  async function leave() {
    if (!editing) await clearDraft(user.id);
    onCancel();
  }

  if (scanning) return <PlateScanner onResult={onScan} onClose={() => setScanning(false)} onFallback={() => (setScanning(false), plateInput.current?.click())} />;

  return (
    <div className="g-capture m-shell">
      <header className="g-header">
        <button className="icon-btn" onClick={() => (hasContent && !editing ? setConfirmLeave(true) : onCancel())} aria-label="Back">
          <ArrowLeft size={20} />
        </button>
        <div style={{ flex: 1, fontFamily: 'Lexend Deca', fontWeight: 600 }}>{editing ? `Edit ${editing.ref}` : 'Record a violation'}</div>
        <span className="chip">
          <Clock size={12} /> {fmtTime(capturedAt)}
        </span>
      </header>

      <main className="g-main g-form">
        {restored && (
          <div className="g-note g-note-info">
            <History size={15} /> Restored the violation you had not saved yet.
            <button className="g-note-btn" onClick={() => void discardDraft()}>
              Discard
            </button>
          </div>
        )}

        {/* ① ② photos */}
        <section className="n-card">
          <div className="g-step">
            <span className="g-step-n">1</span> Photos
          </div>
          <div className="g-shots">
            <ShotTile label="Vehicle" hint="Required · evidence" icon={<Camera size={28} />} shot={vehicle} onTap={() => vehicleInput.current?.click()} />
            <ShotTile label="Scan plate" hint="Reads it for you" icon={<ScanLine size={28} />} shot={plateShot} onTap={openPlate} />
          </div>
          <input ref={vehicleInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => pick('vehicle', e.target.files?.[0])} />
          <input ref={plateInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => pick('plate', e.target.files?.[0])} />
        </section>

        {/* ③ plate */}
        <section className="n-card">
          <div className="g-step">
            <span className="g-step-n">2</span> Number plate
          </div>
          {ocr.state === 'reading' && (
            <div className="g-note g-note-info">
              <Loader2 size={15} className="spin" /> Reading the plate on this phone…
            </div>
          )}
          {ocr.state === 'done' && (
            <div className={`g-note ${(ocr.confidence ?? 0) >= 50 ? 'g-note-ok' : 'g-note-warn'}`}>
              <ScanLine size={15} />
              <span>
                {(ocr.confidence ?? 0) >= 50 ? `Read by the plate reader (${ocr.confidence}% sure) — check it matches the plate.` : `Low-confidence read (${ocr.confidence}%) — check every character.`}
                {!code && ' Type the code — it could not be read.'}
              </span>
            </div>
          )}
          {ocr.state === 'suggest' && ocr.s && (
            <div className="g-note g-note-warn">
              <ScanLine size={15} />
              <span>
                Not sure — is it{' '}
                <b className="mono">
                  {ocr.s.code ? `${ocr.s.code} ` : ''}
                  {ocr.s.number}
                </b>
                ? Check the plate before using it.
              </span>
              <button className="g-note-btn" onClick={() => applyPlate({ ...ocr.s!, confidence: Math.min(ocr.s!.confidence, 60) })}>
                Use it
              </button>
            </div>
          )}
          {ocr.state === 'failed' && (
            <div className="g-note g-note-warn">
              <AlertTriangle size={15} /> {ocr.msg}
            </div>
          )}
          <div className="g-plate-row">
            <select className="select" value={emirate} onChange={(e) => setEmirate(e.target.value)} aria-label="Emirate">
              {EMIRATES.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
            <input
              className="input"
              placeholder="Code"
              aria-label="Plate code"
              autoCapitalize="characters"
              maxLength={3}
              value={code}
              onChange={(e) => {
                setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
                setPlateSource('manual');
              }}
            />
            <input
              className="input g-plate-num"
              placeholder="Number"
              aria-label="Plate number"
              inputMode="numeric"
              maxLength={5}
              value={number}
              onChange={(e) => {
                setNumber(e.target.value.replace(/\D/g, ''));
                setPlateSource('manual');
              }}
            />
          </div>
          {offender && (
            <div className="g-note g-note-danger">
              <Siren size={15} />
              <span>
                <b>Repeat offender</b> — {offender.count} earlier violation{offender.count > 1 ? 's' : ''} ({Object.keys(offender.types).map((k) => typeOf(k)?.short ?? k).join(', ')}). Advice: {offender.escalation.toLowerCase()}.
              </span>
            </div>
          )}
          {sameRecently && (
            <div className="g-note g-note-warn">
              <AlertTriangle size={15} />
              <span>
                You recorded this plate at {fmtTime(sameRecently.capturedAt)} ({typeOf(sameRecently.type)?.short}). Only save again if it is a new violation.
              </span>
            </div>
          )}
        </section>

        {/* ④ type */}
        <section className="n-card">
          <div className="g-step">
            <span className="g-step-n">3</span> Violation
          </div>
          <div className="g-types">
            {VIOLATION_TYPES.map((vt) => (
              <button key={vt.id} type="button" className={`g-type sev-${vt.severity}${type === vt.id ? ' is-on' : ''}`} onClick={() => setType(vt.id)} aria-pressed={type === vt.id}>
                <TypeIcon icon={vt.icon} size={22} />
                <span>{vt.short}</span>
              </button>
            ))}
          </div>
          {t && (
            <div className="faint" style={{ fontSize: 13, marginTop: 8 }}>
              {t.label} · {t.severity} severity
            </div>
          )}
        </section>

        {/* ⑤ location */}
        <section className="n-card">
          <div className="g-step">
            <span className="g-step-n">4</span> Location
          </div>
          <div className={`g-gps g-gps-${gps.state}`}>
            {gps.state === 'locating' && (
              <>
                <Loader2 size={16} className="spin" /> Getting GPS position… (works without internet)
              </>
            )}
            {gps.state === 'fixed' && (
              <>
                {gps.fix.demo ? <FlaskConical size={16} /> : <Crosshair size={16} />}
                <span className="mono">
                  {gps.fix.lat.toFixed(5)}, {gps.fix.lng.toFixed(5)}
                </span>
                <span className="faint">±{gps.fix.accuracy} m</span>
                {gps.fix.demo && <span className="chip chip-accent g-demo-chip">DEMO GPS</span>}
              </>
            )}
            {gps.state === 'unavailable' && (
              <>
                <MapPin size={16} /> {gps.reason}
                <button type="button" className="btn btn-ghost btn-sm" onClick={retry}>
                  <RefreshCw size={14} /> Retry
                </button>
              </>
            )}
          </div>
          {gps.state === 'unavailable' && (
            <button type="button" className="g-link" onClick={() => setGpsMode('demo')}>
              Use the demo position instead
            </button>
          )}
          <div className="field" style={{ marginTop: 10 }}>
            <label htmlFor="area">Area</label>
            <select
              id="area"
              className="select"
              value={areaId}
              onChange={(e) => {
                setAreaId(e.target.value);
                setAreaTouched(true);
              }}
            >
              <option value="">Choose the area…</option>
              {AREAS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label htmlFor="lm">Street / landmark (optional)</label>
            <input id="lm" className="input" value={landmark} onChange={(e) => setLandmark(e.target.value)} placeholder="e.g. Hamdan St, opposite the mall entrance" />
          </div>
        </section>

        {/* ⑥ notes */}
        <section className="n-card">
          <div className="g-step">
            <span className="g-step-n">5</span> Notes {type === 'other' ? '(required)' : '(optional)'}
          </div>
          <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the control room should know" />
        </section>

        {error && (
          <div className="form-error" role="alert">
            <AlertTriangle size={16} style={{ flex: 'none', marginTop: 1 }} />
            <span>{error}</span>
          </div>
        )}
      </main>

      <footer className="g-capture-foot">
        <button className="btn btn-primary btn-lg btn-block n-primary" onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 size={20} className="spin" /> : editing ? <RotateCcw size={20} /> : <Save size={20} />}
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Save violation'}
        </button>
        <div className="faint" style={{ fontSize: 12, textAlign: 'center', marginTop: 6 }}>
          {editing ? 'Not uploaded yet — your changes replace it before upload.' : 'Saved on this phone instantly — uploads automatically when online.'}
        </div>
      </footer>

      {confirmLeave && (
        <Confirm
          title="Discard this violation?"
          body="The photos and details you entered will be deleted from this phone."
          confirm="Discard"
          danger
          onConfirm={() => void leave()}
          onCancel={() => setConfirmLeave(false)}
        />
      )}
    </div>
  );
}

function ShotTile({ label, hint, icon, shot, onTap }: { label: string; hint: string; icon: React.ReactNode; shot: Shot | null; onTap: () => void }) {
  return (
    <button type="button" className={`g-shot${shot ? ' has-shot' : ''}`} onClick={onTap}>
      {shot ? <img src={shot.url} alt={label} /> : <span className="g-shot-icon">{icon}</span>}
      <span className="g-shot-label">
        {shot ? <CheckCircle2 size={14} /> : null} {label}
      </span>
      <span className="g-shot-hint">{shot ? 'Tap to retake' : hint}</span>
    </button>
  );
}
