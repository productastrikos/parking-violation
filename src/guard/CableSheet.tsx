/**
 * "Send to the laptop by cable" — saves each ticket as a picture on the phone
 * (src/guard/cable/cableCard.ts). The laptop then reads the pictures over the
 * USB cable and imports the tickets. Works with no network at all.
 *
 *   iPhone   share sheet → "Save N Images" puts them in Photos, which is what
 *            an iPhone shows a laptop over the cable. If Save Image is missing
 *            (some iOS versions), press and hold a picture → Save to Photos.
 *   Android  saved straight to the Download folder, which the laptop sees over
 *            the cable in "File transfer" mode.
 */
import { useEffect, useState } from 'react';
import { CheckCircle2, ImageDown, Loader2, AlertTriangle, Share, Usb } from 'lucide-react';
import { Sheet } from './Sheet';
import { renderCableCard, canvasToPng, cardFileName } from './cable/cableCard';
import { updateRecord, type LocalRecord } from './offline/db';
import { recordsChanged } from './offline/sync';
import { isIOS } from './offline/device';
import { canShareFiles } from './print/printer';
import { savePictureToPhone } from './cable/nativeSave';
import { PlateChip } from '../lib/ui';
import { NATIVE_APP } from '../lib/api';
import { renderPatrolCard, patrolFileName } from './patrol/patrolCard';
import { getRoutes, markHandedOver, reportsToHandOver, type LocalReport } from './patrol/patrolStore';
import { Route as RouteIcon } from 'lucide-react';

/** One picture to save: a ticket, or a patrol report (src/guard/patrol/patrolCard.ts). */
interface Card {
  key: string;
  rec?: LocalRecord;
  rep?: LocalReport;
  url: string;
  file: File;
}
type Phase = 'making' | 'ready' | 'saving' | 'saved';

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function CableSheet({ recs, onClose, onDone }: { recs: LocalRecord[]; onClose: () => void; onDone: (msg: string) => void }) {
  const ios = isIOS();
  const [list] = useState(recs); // the tickets chosen when the sheet opened
  const [cards, setCards] = useState<Card[]>([]);
  const [made, setMade] = useState(0);
  const [phase, setPhase] = useState<Phase>('making');
  const [err, setErr] = useState<string | null>(null);
  const [tapped, setTapped] = useState(false);
  const [folder, setFolder] = useState('');
  const [todo, setTodo] = useState(recs.length);

  useEffect(() => {
    let alive = true;
    const urls: string[] = [];
    const add = (out: Card[], c: Omit<Card, 'url'>, blob: Blob) => {
      const url = URL.createObjectURL(blob);
      urls.push(url);
      out.push({ ...c, url });
    };
    void (async () => {
      const out: Card[] = [];
      const reps = await reportsToHandOver();
      if (alive) setTodo(list.length + reps.length);
      for (const rec of list) {
        try {
          const { canvas } = await renderCableCard(rec);
          const blob = await canvasToPng(canvas);
          add(out, { key: rec.id, rec, file: new File([blob], cardFileName(rec), { type: 'image/png' }) }, blob);
        } catch (e) {
          if (alive) setErr(`${rec.ref}: ${(e as Error).message}`);
        }
        if (!alive) return;
        setMade((n) => n + 1);
      }
      // Patrol reports go with the tickets, as pictures too.
      for (const rep of reps) {
        try {
          const route = (await getRoutes(rep.guardId))?.routes.find((r) => r.id === rep.routeId) ?? null;
          const { canvas } = await renderPatrolCard(rep, route);
          const blob = await canvasToPng(canvas);
          add(out, { key: rep.id, rep, file: new File([blob], patrolFileName(rep), { type: 'image/png' }) }, blob);
        } catch (e) {
          if (alive) setErr(`Patrol ${rep.routeName}: ${(e as Error).message}`);
        }
        if (!alive) return;
        setMade((n) => n + 1);
      }
      if (alive) {
        setCards(out);
        setPhase('ready');
      }
    })();
    return () => {
      alive = false;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [list]);

  const n = cards.length;
  const nTickets = cards.filter((c) => c.rec).length;
  const nPatrols = cards.filter((c) => c.rep).length;

  async function markSaved() {
    const at = Date.now();
    for (const c of cards) if (c.rec) await updateRecord(c.rec.id, { cableExportedAt: at });
    const reps = cards.filter((c) => c.rep).map((c) => c.rep!.id);
    if (reps.length) await markHandedOver(reps);
    recordsChanged();
    setPhase('saved');
    navigator.vibrate?.(30);
  }

  async function saveShare() {
    setErr(null);
    setPhase('saving');
    setTapped(true);
    try {
      // Files only, no text: iOS drops the files when text is shared with them.
      await navigator.share({ files: cards.map((c) => c.file) });
      await markSaved();
    } catch (e) {
      setPhase('ready');
      if ((e as Error).name !== 'AbortError') setErr(ios ? 'The share sheet did not open. Press and hold each picture below and choose Save to Photos.' : 'Sharing did not work — use Save to this phone instead.');
    }
  }

  /** Android app: straight into Pictures/ParkPatrol through the native plugin. */
  async function saveNative() {
    setErr(null);
    setPhase('saving');
    try {
      let where = '';
      for (const c of cards) where = await savePictureToPhone(c.file.name, c.file);
      setFolder(where);
      await markSaved();
    } catch (e) {
      setPhase('ready');
      setErr(`Could not save the pictures: ${(e as Error).message}`);
    }
  }

  async function saveDownload() {
    setErr(null);
    setPhase('saving');
    for (const c of cards) {
      const a = document.createElement('a');
      a.href = c.url;
      a.download = c.file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      await new Promise((r) => setTimeout(r, 450)); // browsers drop rapid back-to-back downloads
    }
    await markSaved();
  }

  return (
    <Sheet title="Send to the laptop by cable" onClose={onClose}>
      <p className="muted" style={{ margin: 0 }}>
        No network needed. Each ticket — and each patrol report — is saved as a picture on this phone, with a code the laptop reads. Then connect the phone to the laptop with a USB cable.
      </p>

      {phase === 'making' && (
        <div className="g-note g-note-info" role="status">
          <Loader2 size={15} className="spin" /> Preparing {Math.min(made + 1, Math.max(todo, 1))} of {Math.max(todo, 1)}…
        </div>
      )}
      {phase === 'ready' && !n && (
        <div className="g-note g-note-info" role="status">
          Nothing to hand over — no tickets or patrol reports are waiting on this phone.
        </div>
      )}
      {err && (
        <div className="g-note g-note-danger" role="alert">
          <AlertTriangle size={15} /> {err}
        </div>
      )}

      {phase === 'saved' ? (
        <>
          <div className="g-note g-note-ok" role="status">
            <CheckCircle2 size={15} /> {plural(n, 'picture')} saved {NATIVE_APP ? `to ${folder || 'Pictures/ParkPatrol'}` : ios ? 'to Photos' : 'to the Download folder'}. Now connect the cable.
          </div>
          <button
            className="btn btn-primary btn-lg btn-block n-primary"
            onClick={() => onDone(`${[nTickets ? plural(nTickets, 'ticket') : '', nPatrols ? plural(nPatrols, 'patrol report') : ''].filter(Boolean).join(' and ')} ready for the laptop — connect the cable`)}
          >
            <CheckCircle2 size={18} /> Done
          </button>
        </>
      ) : NATIVE_APP ? (
        <>
          <button className="btn btn-primary btn-lg btn-block n-primary" disabled={phase === 'making' || phase === 'saving' || !n} onClick={() => void saveNative()}>
            {phase === 'saving' ? <Loader2 size={18} className="spin" /> : <ImageDown size={18} />} Save {plural(n || list.length, 'picture')} to this phone
          </button>
          <p className="faint" style={{ fontSize: 13, margin: 0 }}>
            They go to <b>Pictures › ParkPatrol</b>.
          </p>
        </>
      ) : ios ? (
        <>
          <button className="btn btn-primary btn-lg btn-block n-primary" disabled={phase === 'making' || !n} onClick={() => void saveShare()}>
            {phase === 'saving' ? <Loader2 size={18} className="spin" /> : <ImageDown size={18} />} Save {plural(n || list.length, 'picture')} to Photos
          </button>
          <p className="faint" style={{ fontSize: 13, margin: 0 }}>
            In the share sheet choose <b>Save {n === 1 ? 'Image' : `${n} Images`}</b>.
          </p>
          {tapped && (
            <button className="btn btn-block" onClick={() => void markSaved()}>
              <CheckCircle2 size={16} /> I have saved them to Photos
            </button>
          )}
        </>
      ) : (
        <>
          <button className="btn btn-primary btn-lg btn-block n-primary" disabled={phase === 'making' || phase === 'saving' || !n} onClick={() => void saveDownload()}>
            {phase === 'saving' ? <Loader2 size={18} className="spin" /> : <ImageDown size={18} />} Save {plural(n || list.length, 'picture')} to this phone
          </button>
          <p className="faint" style={{ fontSize: 13, margin: 0 }}>
            They go to the <b>Download</b> folder.
          </p>
          {canShareFiles() && phase !== 'making' && (
            <button className="btn btn-block" onClick={() => void saveShare()}>
              <Share size={16} /> Share instead (Gallery, Files)
            </button>
          )}
        </>
      )}

      <ol className="g-cable-steps">
        <li>
          <Usb size={15} /> Connect this phone to the laptop with the USB cable.
        </li>
        <li>{ios ? 'Unlock the iPhone and tap Allow (or Trust) when it asks.' : 'Pull down the notification shade, tap the USB notice and choose File transfer.'}</li>
        <li>On the laptop dashboard press Receive from phone.</li>
      </ol>

      {cards.length > 0 && (
        <>
          {ios && (
            <p className="faint" style={{ fontSize: 12.5, margin: 0 }}>
              No Save Image option? Press and hold a picture below and choose Save to Photos.
            </p>
          )}
          <div className="g-cable-cards">
            {cards.map((c) => (
              <figure key={c.key}>
                <img src={c.url} alt={c.rec ? `Ticket ${c.rec.ref}` : `Patrol report ${c.rep?.routeName}`} />
                <figcaption>
                  {c.rec ? (
                    <>
                      <PlateChip plate={c.rec.server?.plate ?? c.rec.plate} /> <span className="faint mono">{c.rec.ref}</span>
                    </>
                  ) : (
                    <>
                      <RouteIcon size={13} /> <span>Patrol · {c.rep?.routeName}</span>
                    </>
                  )}
                </figcaption>
              </figure>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}
