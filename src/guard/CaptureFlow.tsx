/**
 * Record one violation, online or not. About 30 seconds for a guard:
 *
 *   ① photo of the vehicle (evidence)        — required
 *   ② close-up of the plate (optional)       — read on the phone, guard confirms
 *   ③ plate: emirate · code · number
 *   ④ what the violation is                   — one tap on a grid
 *   ⑤ where: GPS (automatic) + area + landmark — the area still works with no GPS
 *   ⑥ notes (optional)                        → Save
 *
 * Save writes to the phone's database and returns at once — it never waits
 * for the network. The sync engine uploads it when it can.
 *
 * Photos use the phone's own camera through the file input (`capture`): it
 * works offline, on iPhone and Android, with no camera-permission plumbing.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Camera, CheckCircle2, Crosshair, Loader2, MapPin, RefreshCw, ScanLine, Save, AlertTriangle, Clock } from 'lucide-react';
import { VIOLATION_TYPES, AREAS, EMIRATES, typeOf, areaOf, fmtDateTime, type User, type Gps, type Severity } from '../lib/api';
import { TypeIcon } from '../lib/ui';
import { saveRecord, nextSeq, type LocalRecord } from './offline/db';
import { deviceInfo, deviceLabel, uuid } from './offline/device';
import { processPhoto } from './offline/photo';
import { readPlate } from './offline/plateOcr';
import { getStatus } from './offline/sync';

type GpsState = { state: 'locating' } | { state: 'fixed'; fix: Gps } | { state: 'unavailable'; reason: string };

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * GPS needs no internet, but a first fix can take a while (and never comes in
 * a basement). Watch for up to 25 s and keep the most accurate fix; the guard
 * is never blocked on it.
 */
function useGps() {
  const [gps, setGps] = useState<GpsState>({ state: 'locating' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setGps({ state: 'unavailable', reason: 'This browser has no location service' });
      return;
    }
    setGps({ state: 'locating' });
    let best: Gps | null = null;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const fix = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) };
        if (!best || (fix.accuracy ?? 9e9) <= (best.accuracy ?? 9e9)) {
          best = fix;
          setGps({ state: 'fixed', fix });
        }
      },
      (err) => {
        if (best) return;
        setGps({
          state: 'unavailable',
          reason: err.code === err.PERMISSION_DENIED ? 'Location permission is off — allow it in the phone settings' : 'No GPS signal here — pick the area below',
        });
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 60_000 },
    );
    const stop = setTimeout(() => navigator.geolocation.clearWatch(id), 25_000);
    return () => {
      clearTimeout(stop);
      navigator.geolocation.clearWatch(id);
    };
  }, [attempt]);
  return { gps, retry: () => setAttempt((n) => n + 1) };
}

interface Shot {
  file: File;
  url: string;
  at: number;
}

export default function CaptureFlow({ user, onCancel, onSaved }: { user: User; onCancel: () => void; onSaved: (online: boolean | null) => void }) {
  const [vehicle, setVehicle] = useState<Shot | null>(null);
  const [plateShot, setPlateShot] = useState<Shot | null>(null);
  const [emirate, setEmirate] = useState('AD');
  const [code, setCode] = useState('');
  const [number, setNumber] = useState('');
  const [plateSource, setPlateSource] = useState<'ocr' | 'manual'>('manual');
  const [ocr, setOcr] = useState<{ state: 'idle' | 'reading' | 'done' | 'failed'; msg?: string; confidence?: number }>({ state: 'idle' });
  const [type, setType] = useState<string>('');
  const [areaId, setAreaId] = useState(user.area || '');
  const [areaTouched, setAreaTouched] = useState(false);
  const [landmark, setLandmark] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { gps, retry } = useGps();
  const vehicleInput = useRef<HTMLInputElement>(null);
  const plateInput = useRef<HTMLInputElement>(null);
  const openedAt = useMemo(() => Date.now(), []);

  // Free preview object URLs when leaving.
  useEffect(() => () => {
    if (vehicle) URL.revokeObjectURL(vehicle.url);
    if (plateShot) URL.revokeObjectURL(plateShot.url);
  }, [vehicle, plateShot]);

  // With a GPS fix, preselect the nearest area (unless the guard already chose one).
  useEffect(() => {
    if (gps.state !== 'fixed' || areaTouched) return;
    const nearest = AREAS.map((a) => ({ a, d: distanceKm(gps.fix, a) })).sort((x, y) => x.d - y.d)[0];
    if (nearest && nearest.d < 6) setAreaId(nearest.a.id);
  }, [gps, areaTouched]);

  function pick(kind: 'vehicle' | 'plate', file?: File | null) {
    if (!file) return;
    const shot = { file, url: URL.createObjectURL(file), at: Date.now() };
    if (kind === 'vehicle') setVehicle(shot);
    else {
      setPlateShot(shot);
      void runOcr(file);
    }
  }

  async function runOcr(file: File) {
    setOcr({ state: 'reading' });
    try {
      const r = await readPlate(file);
      if (!r.number) {
        setOcr({ state: 'failed', msg: 'Could not read a plate number — type it below' });
        return;
      }
      setNumber(r.number);
      setCode(r.code);
      if (r.emirate) setEmirate(r.emirate);
      setPlateSource('ocr');
      setOcr({ state: 'done', confidence: r.confidence });
    } catch {
      setOcr({ state: 'failed', msg: 'Plate reader is not available on this phone right now — type the plate' });
    }
  }

  const capturedAt = vehicle?.at ?? openedAt;
  const t = typeOf(type);

  async function save() {
    setError(null);
    if (!vehicle) return setError('Take a photo of the vehicle first');
    if (!type) return setError('Choose what the violation is');
    if (type === 'other' && notes.trim().length < 3) return setError('For "Other", describe the violation in the notes');
    if (!areaId && gps.state !== 'fixed') return setError('Choose the area — there is no GPS fix');
    setSaving(true);
    try {
      const dev = await deviceInfo();
      const label = await deviceLabel();
      const fix = gps.state === 'fixed' ? gps.fix : null;
      const area = areaOf(areaId);
      const stamp = [
        `${fmtDateTime(capturedAt)} · ${t?.short ?? ''}`,
        `${area?.label ?? ''}${landmark ? ` · ${landmark}` : ''}${fix ? ` · ${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)}` : ''}`,
        `${user.name} · Park Patrol`,
      ];
      const v = await processPhoto(vehicle.file, stamp);
      const p = plateShot ? await processPhoto(plateShot.file) : null;
      URL.revokeObjectURL(v.previewUrl);
      if (p) URL.revokeObjectURL(p.previewUrl);

      const seq = await nextSeq();
      const d = new Date(capturedAt);
      const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
      const online = getStatus().online;
      const rec: LocalRecord = {
        id: uuid(),
        ref: `PV-${ymd}-${dev.deviceId.slice(0, 4).toUpperCase()}-${String(seq).padStart(3, '0')}`,
        type,
        severity: (t?.severity ?? 'medium') as Severity,
        plate: { emirate, code: code.trim().toUpperCase(), number: number.replace(/\D/g, ''), raw: `${code} ${number}`.trim(), source: plateSource, confidence: plateSource === 'ocr' ? ocr.confidence : undefined },
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
      await saveRecord(rec, [{ kind: 'vehicle', buf: v.buf, type: v.type }, ...(p ? [{ kind: 'plate' as const, buf: p.buf, type: p.type }] : [])]);
      onSaved(online);
    } catch (e) {
      setError(`Could not save: ${(e as Error).message}`);
      setSaving(false);
    }
  }

  return (
    <div className="g-capture">
      <header className="g-header">
        <button className="icon-btn" onClick={onCancel} aria-label="Back">
          <ArrowLeft size={20} />
        </button>
        <div style={{ flex: 1, fontFamily: 'Lexend Deca', fontWeight: 600 }}>Record a violation</div>
        <span className="chip">
          <Clock size={12} /> {fmtDateTime(capturedAt).split(', ')[1]}
        </span>
      </header>

      <main className="g-main g-form">
        {/* ① ② photos */}
        <section>
          <div className="g-step">1 · Photos</div>
          <div className="g-shots">
            <ShotTile label="Vehicle" hint="Required" shot={vehicle} onTap={() => vehicleInput.current?.click()} />
            <ShotTile label="Plate close-up" hint="Fills the plate" shot={plateShot} onTap={() => plateInput.current?.click()} />
          </div>
          <input ref={vehicleInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => pick('vehicle', e.target.files?.[0])} />
          <input ref={plateInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => pick('plate', e.target.files?.[0])} />
        </section>

        {/* ③ plate */}
        <section>
          <div className="g-step">2 · Number plate</div>
          {ocr.state === 'reading' && (
            <div className="g-note g-note-info">
              <Loader2 size={15} className="spin" /> Reading the plate on this phone…
            </div>
          )}
          {ocr.state === 'done' && (
            <div className="g-note g-note-ok">
              <ScanLine size={15} /> Read by the plate reader ({ocr.confidence}% sure) — check it matches the plate.
              {!code && ' Type the code — it could not be read.'}
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
        </section>

        {/* ④ type */}
        <section>
          <div className="g-step">3 · Violation</div>
          <div className="g-types">
            {VIOLATION_TYPES.map((vt) => (
              <button key={vt.id} type="button" className={`g-type${type === vt.id ? ' is-on' : ''}`} onClick={() => setType(vt.id)} aria-pressed={type === vt.id}>
                <TypeIcon icon={vt.icon} size={22} />
                <span>{vt.short}</span>
              </button>
            ))}
          </div>
          {t && <div className="faint" style={{ fontSize: 13, marginTop: 8 }}>{t.label}</div>}
        </section>

        {/* ⑤ location */}
        <section>
          <div className="g-step">4 · Location</div>
          <div className={`g-gps g-gps-${gps.state}`}>
            {gps.state === 'locating' && (
              <>
                <Loader2 size={16} className="spin" /> Getting GPS position… (works without internet)
              </>
            )}
            {gps.state === 'fixed' && (
              <>
                <Crosshair size={16} />
                <span className="mono">
                  {gps.fix.lat.toFixed(5)}, {gps.fix.lng.toFixed(5)}
                </span>
                <span className="faint">±{gps.fix.accuracy} m</span>
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
            <input id="lm" className="input" value={landmark} onChange={(e) => setLandmark(e.target.value)} placeholder="e.g. Schneider Building, Basement P1, bay 23" />
          </div>
        </section>

        {/* ⑥ notes */}
        <section>
          <div className="g-step">5 · Notes {type === 'other' ? '(required)' : '(optional)'}</div>
          <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the control room should know" />
        </section>

        {error && (
          <div className="form-error">
            <AlertTriangle size={16} style={{ flex: 'none', marginTop: 1 }} />
            <span>{error}</span>
          </div>
        )}
      </main>

      <footer className="g-capture-foot">
        <button className="btn btn-primary btn-lg btn-block" onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 size={20} className="spin" /> : <Save size={20} />}
          {saving ? 'Saving…' : 'Save violation'}
        </button>
        <div className="faint" style={{ fontSize: 12, textAlign: 'center', marginTop: 6 }}>
          Saved on this phone instantly — uploads automatically when online.
        </div>
      </footer>
    </div>
  );
}

function ShotTile({ label, hint, shot, onTap }: { label: string; hint: string; shot: Shot | null; onTap: () => void }) {
  return (
    <button type="button" className={`g-shot${shot ? ' has-shot' : ''}`} onClick={onTap}>
      {shot ? <img src={shot.url} alt={label} /> : <Camera size={28} />}
      <span className="g-shot-label">
        {shot ? <CheckCircle2 size={14} /> : null} {label}
      </span>
      <span className="g-shot-hint">{shot ? 'Tap to retake' : hint}</span>
    </button>
  );
}
