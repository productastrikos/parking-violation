/**
 * Settings → Q&A: how to use Park Patrol, in the guard's words. One searchable
 * list; each answer opens in place. Answers follow the app the guard is
 * holding (Android app, web app, online or offline mode).
 */
import { useMemo, useState } from 'react';
import { Search, ChevronDown } from 'lucide-react';
import { Sheet } from './Sheet';
import { CABLE_ONLY, CABLE_ONLY_BUILD, NATIVE_APP } from '../lib/api';

interface QA {
  q: string;
  a: React.ReactNode;
  /** extra words to match in the search box */
  k?: string;
}
interface Group {
  title: string;
  items: QA[];
}

const WEB_URL = 'https://parking.astrikos.xyz:8443/app';

function groups(): Group[] {
  const savedTo = NATIVE_APP ? 'Pictures › ParkPatrol' : 'Download';
  return [
    {
      title: 'Getting started',
      items: [
        {
          q: 'How do I sign in?',
          a: (
            <>
              Use your username and password. Demo accounts: <b>guard1</b> … <b>guard4</b> (and <b>supervisor</b>), password <b>Astrikos2026</b>.{' '}
              {CABLE_ONLY_BUILD
                ? 'This app never needs the internet — not even for the first sign-in.'
                : 'Online, the first sign-in on a phone needs internet; after that you can sign in with no connection. With Online switched off (Settings), the demo accounts work with no internet at all.'}
            </>
          ),
          k: 'login password account username',
        },
        {
          q: 'How do I install the app on a phone?',
          a: (
            <>
              <b>Android:</b> copy <b>ParkPatrol.apk</b> to the phone and tap it (allow installing from Files). <b>iPhone:</b> open <b>{WEB_URL}</b> in <b>Chrome</b> → Share (in the address bar) → <b>Add to Home Screen</b>, then open Park Patrol from the Home Screen and sign in once while online. Mind the <b>:8443</b> in the address.
            </>
          ),
          k: 'install apk iphone android chrome home screen',
        },
        {
          q: 'Which version am I on?',
          a: <>Settings → <b>Version</b> shows the version and the build time. The laptop shows the same for each phone on its Field Team page.</>,
          k: 'update build',
        },
      ],
    },
    {
      title: 'Recording a violation',
      items: [
        {
          q: 'How do I record a violation?',
          a: (
            <>
              Tap the <b>camera button</b> (or <b>Record a violation</b> on Home) → take the vehicle photo → read or type the plate → choose the violation type → <b>Save</b>. It is saved on the phone at once, with the place and time.
            </>
          ),
          k: 'capture new ticket photo save',
        },
        {
          q: 'The plate is not read — what now?',
          a: (
            <>
              Hold the phone straight and close to the plate and try again, or type the number yourself. If it still cannot be read, tap <b>Photo only</b>: the plate photo is kept and you can save without typing the number.
            </>
          ),
          k: 'ocr number recognise scan photo only',
        },
        {
          q: 'I made a mistake — can I correct a record?',
          a: <>Open it in <b>Records</b> → <b>Edit</b> while it is still only on this phone. Once it has reached the control room, open it and tap <b>Report a mistake</b> — the control room corrects it.</>,
          k: 'edit change wrong',
        },
        {
          q: 'What is the GPS source?',
          a: (
            <>
              Settings → <b>GPS source</b>. <b>Real GPS</b> uses the phone's GPS. <b>Demo</b> places you in your Abu Dhabi patrol area for demonstrations — those records are marked DEMO everywhere.
            </>
          ),
          k: 'location map position demo',
        },
      ],
    },
    {
      title: 'Fines and printing',
      items: [
        {
          q: 'How do I issue the fine?',
          a: (
            <>
              After <b>Save</b> the print screen opens (or open the record → <b>Print penalty notice</b>): <b>Print notice</b> prints the penalty notice for the driver; <b>Issue without printing</b> issues the fine with no paper. Either way the notice number, offence code, fine and pay-by date are recorded.
            </>
          ),
          k: 'notice receipt ticket penalty aed',
        },
        {
          q: 'How do I set up the printer?',
          a: (
            <>
              Charge the printer and load the 58 mm roll. On <b>Android</b>: phone Settings → Bluetooth → pair the printer (PIN <b>0000</b> or <b>1234</b>) → Park Patrol Settings → <b>Fine printer</b> → <b>Bluetooth printer</b> → <b>Choose printer</b> → <b>Test print</b>. An iPhone cannot print to this printer (it has no iPhone support) — use <b>Issue without printing</b> there.
            </>
          ),
          k: 'bluetooth netum pair paper 58',
        },
        {
          q: 'How do I print a notice again?',
          a: <>Open the record → <b>Reprint penalty notice</b>. A reprint is marked as a duplicate copy.</>,
          k: 'reprint duplicate copy',
        },
        {
          q: 'Who sets the fine amounts?',
          a: <>The supervisor or admin, on the laptop dashboard (or in Settings → Fines when signed in online as a supervisor). Every change is logged.</>,
          k: 'amount schedule price',
        },
      ],
    },
    {
      title: 'Online, offline and the cable',
      items: [
        {
          q: 'What does the Online switch do?',
          a: CABLE_ONLY_BUILD ? (
            <>This app always works offline: it never uses the internet, and tickets go to the laptop by USB cable.</>
          ) : (
            <>
              Settings → <b>Online</b>. <b>On</b>: records upload to the control room whenever there is internet. <b>Off</b>: the app never uses the internet — records stay on the phone until you hand them to the laptop by cable. The app restarts when you switch. {CABLE_ONLY ? 'It is off now.' : 'It is on now.'}
            </>
          ),
          k: 'offline mode wifi internet network toggle',
        },
        {
          q: 'How do I send tickets to the laptop by cable?',
          a: (
            <>
              Home → <b>Send to laptop by cable</b> (always there, online or offline) → save the pictures (<b>iPhone:</b> Save to Photos · <b>Android:</b> saved to {savedTo}). Connect the phone to the laptop with the USB cable. On the laptop press <b>Receive from phone</b> (top of the dashboard) → choose the pictures. Each ticket and patrol report is one picture with its data in a code.
            </>
          ),
          k: 'usb hand over transfer laptop pictures upload',
        },
        {
          q: 'The laptop does not see my iPhone',
          a: (
            <>
              Use the Apple cable, plugged straight into the laptop. Unlock the iPhone and keep it unlocked (Settings → Display &amp; Brightness → Auto-Lock → Never for the demo), then tap <b>Trust</b> / <b>Allow</b>. No question shown? iPhone Settings → General → Transfer or Reset iPhone → Reset → <b>Reset Location &amp; Privacy</b>, then plug in again. On Windows install <b>Apple Devices</b> from the Microsoft Store. New pictures appear after unplugging and plugging in again (This PC › Apple iPhone › Internal Storage › DCIM).
            </>
          ),
          k: 'iphone trust allow usb dcim windows photos',
        },
        {
          q: 'The laptop does not see my Android phone',
          a: <>Use a data cable. On the phone pull down the notification → USB → <b>File transfer</b>. The pictures are in {savedTo}.</>,
          k: 'android usb file transfer mtp',
        },
        {
          q: 'Can a ticket be counted twice?',
          a: <>No. The laptop recognises a ticket it already has — also when the same ticket uploads online later.</>,
          k: 'duplicate twice again',
        },
      ],
    },
    {
      title: 'Patrol',
      items: [
        {
          q: 'How do I get my patrol route?',
          a: (
            <>
              <b>Patrol</b> → <b>Scan route code</b> → scan the code the supervisor shows on the laptop (Field Team → Patrol routes → <b>Code for phone</b>), or take a photo of it. {CABLE_ONLY ? '' : 'Online, your route also arrives by itself.'}
            </>
          ),
          k: 'route qr code checkpoint',
        },
        {
          q: 'How do I do a patrol?',
          a: (
            <>
              Patrol → <b>Start patrol</b> and walk the route: each checkpoint ticks off on the map when you reach it. Tap <b>I'm at …</b> if GPS is weak. For a demo use <b>Demo: walk the route</b>. At the end tap <b>Finish patrol</b>, then <b>Send to laptop by cable</b>.
            </>
          ),
          k: 'start finish walk checkpoints map',
        },
      ],
    },
    {
      title: 'Your data',
      items: [
        {
          q: 'What happens to my records if I sign out?',
          a: <>They stay on the phone and are still handed over (or uploaded) for the guard who recorded them.</>,
          k: 'sign out logout lost',
        },
        {
          q: 'How does the app get updated?',
          a: NATIVE_APP ? (
            <>Install the new <b>ParkPatrol.apk</b> over the old one. Hand your tickets to the laptop first, in case the phone asks to remove the old app.</>
          ) : (
            <>It updates by itself when it is online and no form is open. Settings → Version shows the build you are on.</>
          ),
          k: 'update upgrade new version apk',
        },
      ],
    },
  ];
}

export function HelpQA({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const all = useMemo(groups, []);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return all;
    // Match the question and the keywords (answers are JSX; their key words are listed in k).
    return all.map((g) => ({ ...g, items: g.items.filter((i) => `${i.q} ${i.k ?? ''}`.toLowerCase().includes(t)) })).filter((g) => g.items.length);
  }, [all, q]);

  return (
    <Sheet title="Q&A — how to use Park Patrol" onClose={onClose}>
      <div className="n-input-wrap">
        <Search size={17} />
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search, e.g. printer, cable, plate" aria-label="Search the Q&A" />
      </div>
      {shown.length === 0 && <p className="muted" style={{ margin: 0 }}>Nothing found for “{q}”.</p>}
      {shown.map((g) => (
        <section key={g.title} className="g-qa-group">
          <h4>{g.title}</h4>
          {g.items.map((i) => (
            <details key={i.q} className="g-qa" open={Boolean(q.trim())}>
              <summary>
                <span>{i.q}</span>
                <ChevronDown size={16} className="g-qa-chev" />
              </summary>
              <div className="g-qa-a">{i.a}</div>
            </details>
          ))}
        </section>
      ))}
    </Sheet>
  );
}
