/**
 * Live plate scanner — point the phone at a plate and it reads itself.
 *
 * The camera stream (getUserMedia, rear camera) fills the screen with a
 * plate-shaped guide box. About twice a second the box region of the current
 * frame is cut out, cleaned up and read on the phone (plateOcr.readFrame).
 * Readings are VOTED across frames: the plate locks when two frames agree with
 * reasonable confidence (or one is very sure), the phone vibrates, and the
 * frame itself becomes the plate photo — evidence of what was read.
 *
 * Works offline (camera and reader are both on the phone), on Android Chrome
 * and iPhone Safari / Home Screen app (iOS 14.3+). If the camera cannot be
 * opened (permission, old browser), the guard falls back to the phone's own
 * camera app via `onFallback`, which runs the still-photo reader instead.
 */
import { useEffect, useRef, useState } from 'react';
import { Camera, Check, Flashlight, FlashlightOff, Loader2, RotateCcw, ScanLine, X } from 'lucide-react';
import { readFrame, readPlate, type PlateRead } from './offline/plateOcr';
import { PlateChip } from '../lib/ui';

export interface ScanResult extends PlateRead {
  photo: Blob;
}

const GUIDE_RATIO = 4.2; // UAE plates are long and low
const LOCK_HITS = 2;

export default function PlateScanner({ onResult, onClose, onFallback }: { onResult: (r: ScanResult) => void; onClose: () => void; onFallback: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [state, setState] = useState<'starting' | 'scanning' | 'locked' | 'error'>('starting');
  const [error, setError] = useState('');
  const [seen, setSeen] = useState<{ number: string; hits: number } | null>(null);
  const [locked, setLocked] = useState<ScanResult | null>(null);
  const [torch, setTorch] = useState<boolean | null>(null);
  const [shooting, setShooting] = useState(false);
  const votes = useRef(new Map<string, { hits: number; conf: number; codes: Map<string, number>; emirate: string | null }>());
  const busy = useRef(false);

  // Start the rear camera.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        if (!alive) return s.getTracks().forEach((t) => t.stop());
        stream.current = s;
        const v = video.current!;
        v.srcObject = s;
        await v.play().catch(() => {});
        const caps = (s.getVideoTracks()[0]?.getCapabilities?.() ?? {}) as { torch?: boolean };
        if (caps.torch) setTorch(false);
        setState('scanning');
      } catch (e) {
        const name = (e as { name?: string }).name;
        setError(name === 'NotAllowedError' ? 'Camera permission is off for this app. Allow it in the phone settings, or use the camera app instead.' : 'The live camera is not available here. Use the camera app instead.');
        setState('error');
      }
    })();
    return () => {
      alive = false;
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  /** The guide box, in the video's own pixels (the video is shown with object-fit: cover). */
  function guideCrop(maxW = 1000): HTMLCanvasElement | null {
    const v = video.current;
    const b = box.current?.getBoundingClientRect();
    const st = stage.current?.getBoundingClientRect();
    if (!v || !b || !st || !v.videoWidth) return null;
    const scale = Math.max(st.width / v.videoWidth, st.height / v.videoHeight);
    const ox = (st.width - v.videoWidth * scale) / 2;
    const oy = (st.height - v.videoHeight * scale) / 2;
    const sx = (b.left - st.left - ox) / scale;
    const sy = (b.top - st.top - oy) / scale;
    const sw = b.width / scale;
    const sh = b.height / scale;
    const k = Math.min(1, maxW / sw);
    const c = document.createElement('canvas');
    c.width = Math.round(sw * k);
    c.height = Math.round(sh * k);
    c.getContext('2d')!.drawImage(v, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c;
  }

  function frameBlob(): Promise<Blob | null> {
    const v = video.current;
    if (!v?.videoWidth) return Promise.resolve(null);
    const k = Math.min(1, 1600 / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(v.videoWidth * k);
    c.height = Math.round(v.videoHeight * k);
    c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
    return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
  }

  async function lock(r: PlateRead) {
    const photo = await frameBlob();
    if (!photo) return;
    navigator.vibrate?.(70);
    setLocked({ ...r, photo });
    setState('locked');
    // The guide box may have cut off the code box: one full read of the locked frame, kept only if it agrees on the number.
    if (!r.code || !r.emirate) {
      try {
        const full = await readPlate(photo);
        if (full.number === r.number && (full.code || full.emirate)) {
          setLocked((cur) => (cur && cur.number === r.number ? { ...cur, code: cur.code || full.code, emirate: cur.emirate || full.emirate } : cur));
        }
      } catch {
        /* keep the frame read */
      }
    }
  }

  // The read loop.
  useEffect(() => {
    if (state !== 'scanning') return;
    let alive = true;
    const tick = async () => {
      if (!alive || busy.current) return;
      busy.current = true;
      try {
        const crop = guideCrop();
        if (!crop) return;
        const r = await readFrame(crop);
        if (!alive || !r?.number || r.number.length < 3) return;
        const v = votes.current.get(r.number) ?? { hits: 0, conf: 0, codes: new Map(), emirate: null };
        v.hits += 1;
        v.conf += r.confidence;
        if (r.code) v.codes.set(r.code, (v.codes.get(r.code) ?? 0) + 1);
        v.emirate ||= r.emirate;
        votes.current.set(r.number, v);
        setSeen({ number: r.number, hits: v.hits });
        const avg = v.conf / v.hits;
        if ((v.hits >= LOCK_HITS && avg >= 55) || (v.hits === 1 && r.confidence >= 88)) {
          const code = [...v.codes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
          await lock({ number: r.number, code, emirate: v.emirate, raw: r.raw, confidence: Math.round(Math.min(99, avg + (v.hits - 1) * 5)) });
        }
      } catch {
        /* a bad frame — the next one will do */
      } finally {
        busy.current = false;
      }
    };
    const id = window.setInterval(() => void tick(), 450);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [state]);

  async function shutter() {
    setShooting(true);
    try {
      const photo = await frameBlob();
      if (!photo) return;
      const r = await readPlate(photo);
      navigator.vibrate?.(40);
      setLocked({ ...r, photo });
      setState('locked');
    } finally {
      setShooting(false);
    }
  }

  async function toggleTorch() {
    const track = stream.current?.getVideoTracks()[0];
    if (!track || torch === null) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
      setTorch(!torch);
    } catch {
      setTorch(null);
    }
  }

  function rescan() {
    votes.current.clear();
    setSeen(null);
    setLocked(null);
    setState('scanning');
  }

  return (
    <div className="ps-wrap" role="dialog" aria-label="Scan number plate">
      <div className="ps-stage" ref={stage}>
        <video ref={video} className="ps-video" playsInline muted autoPlay />
        <div className="ps-shade" />
        <div className={`ps-box${state === 'locked' ? ' is-locked' : ''}`} ref={box} style={{ aspectRatio: String(GUIDE_RATIO) }}>
          <span className="ps-corner tl" />
          <span className="ps-corner tr" />
          <span className="ps-corner bl" />
          <span className="ps-corner br" />
          {state === 'scanning' && <span className="ps-sweep" />}
        </div>
      </div>

      <header className="ps-top">
        <button className="ps-round" onClick={onClose} aria-label="Close scanner">
          <X size={22} />
        </button>
        <div className="ps-title">
          <ScanLine size={16} /> Scan number plate
        </div>
        {torch !== null ? (
          <button className="ps-round" onClick={() => void toggleTorch()} aria-label="Torch">
            {torch ? <FlashlightOff size={20} /> : <Flashlight size={20} />}
          </button>
        ) : (
          <span style={{ width: 44 }} />
        )}
      </header>

      <div className="ps-bottom">
        {state === 'starting' && (
          <div className="ps-hint">
            <Loader2 size={16} className="spin" /> Opening the camera…
          </div>
        )}
        {state === 'scanning' && (
          <>
            <div className="ps-hint">{seen ? <>Reading <b className="mono">{seen.number}</b> — hold steady…</> : 'Fill the box with the plate, straight on'}</div>
            <div className="ps-actions">
              <button className="ps-link" onClick={onFallback}>
                <Camera size={16} /> Camera app
              </button>
              <button className="ps-shutter" onClick={() => void shutter()} aria-label="Take photo and read" disabled={shooting}>
                {shooting ? <Loader2 size={26} className="spin" /> : <span />}
              </button>
              <span className="ps-link ps-link-ghost">works offline</span>
            </div>
          </>
        )}
        {state === 'locked' && locked && (
          <div className="ps-result">
            {locked.number ? (
              <>
                <PlateChip plate={{ emirate: locked.emirate ?? 'AD', code: locked.code, number: locked.number, source: 'ocr' }} large />
                <div className="ps-conf">{locked.confidence >= 50 ? `${locked.confidence}% sure — check it matches the plate` : `Low confidence (${locked.confidence}%) — check it carefully`}</div>
              </>
            ) : (
              <div className="ps-conf">No plate number found in that shot. Try again, closer and straight on — or use it and type the plate.</div>
            )}
            <div className="ps-result-actions">
              <button className="btn btn-lg" onClick={rescan}>
                <RotateCcw size={18} /> Again
              </button>
              <button className="btn btn-primary btn-lg" onClick={() => onResult(locked)}>
                <Check size={18} /> Use {locked.number ? 'plate' : 'photo'}
              </button>
            </div>
          </div>
        )}
        {state === 'error' && (
          <div className="ps-result">
            <div className="ps-conf">{error}</div>
            <div className="ps-result-actions">
              <button className="btn btn-lg" onClick={onClose}>
                Cancel
              </button>
              <button className="btn btn-primary btn-lg" onClick={onFallback}>
                <Camera size={18} /> Camera app
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
