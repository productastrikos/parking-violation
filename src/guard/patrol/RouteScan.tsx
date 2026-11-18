/**
 * Scan the route code shown on the dashboard (Field Team → Patrol routes →
 * Code for phone). Live camera, read on the phone with jsQR — or a photo of
 * the code when the live camera is not available. No network needed.
 */
import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Camera, Loader2, QrCode, X } from 'lucide-react';
import { parseRoutePack, ROUTE_TAG, type RoutePack } from '../../lib/patrol';

function decode(src: CanvasImageSource, w: number, h: number, maxW = 960) {
  const k = Math.min(1, maxW / w);
  const c = document.createElement('canvas');
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  return jsQR(d.data, c.width, c.height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
}

export default function RouteScan({ onResult, onClose }: { onResult: (p: RoutePack) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const photo = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<'starting' | 'scanning' | 'error'>('starting');
  const [msg, setMsg] = useState('');
  const done = useRef(false);

  const take = (text: string | null) => {
    if (!text || done.current) return false;
    const pack = parseRoutePack(text);
    if (pack) {
      done.current = true;
      navigator.vibrate?.(60);
      onResult(pack);
      return true;
    }
    setMsg(text.includes('PP') && !text.includes(ROUTE_TAG) ? 'That is a different Park Patrol code — show the route code (Field Team → Code for phone).' : 'That is not a Park Patrol route code.');
    return false;
  };

  useEffect(() => {
    let alive = true;
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (!alive) return stream.getTracks().forEach((t) => t.stop());
        const v = video.current!;
        v.srcObject = stream;
        await v.play().catch(() => {});
        setState('scanning');
        timer = window.setInterval(() => {
          if (!v.videoWidth || done.current) return;
          take(decode(v, v.videoWidth, v.videoHeight));
        }, 300);
      } catch (e) {
        setState('error');
        setMsg((e as { name?: string }).name === 'NotAllowedError' ? 'Camera permission is off — allow it, or take a photo of the code.' : 'The live camera is not available here — take a photo of the code.');
      }
    })();
    return () => {
      alive = false;
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fromPhoto(f?: File | null) {
    if (!f) return;
    try {
      const bmp = await createImageBitmap(f);
      const ok = take(decode(bmp, bmp.width, bmp.height, 1600)) || take(decode(bmp, bmp.width, bmp.height, 800));
      bmp.close();
      if (!ok && !done.current) setMsg('No route code found in that photo — fill the frame with the code and try again.');
    } catch {
      setMsg('Could not read that photo.');
    }
  }

  return (
    <div className="ps-wrap" role="dialog" aria-label="Scan route code">
      <div className="ps-stage">
        <video ref={video} className="ps-video" playsInline muted autoPlay />
        <div className="ps-shade" />
        <div className="ps-box rs-box" />
      </div>
      <header className="ps-top">
        <button className="ps-round" onClick={onClose} aria-label="Close">
          <X size={22} />
        </button>
        <div className="ps-title">
          <QrCode size={16} /> Scan route code
        </div>
        <span style={{ width: 44 }} />
      </header>
      <div className="ps-bottom">
        <div className="ps-hint">
          {state === 'starting' ? (
            <>
              <Loader2 size={16} className="spin" /> Opening the camera…
            </>
          ) : (
            msg || 'Point the camera at the route code on the dashboard (Field Team → Code for phone)'
          )}
        </div>
        <div className="ps-actions">
          <button className="ps-link" onClick={() => photo.current?.click()}>
            <Camera size={16} /> Take a photo of the code
          </button>
        </div>
        <input ref={photo} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void fromPhoto(e.target.files?.[0])} />
      </div>
    </div>
  );
}
