/**
 * "What URL do I open on the phone?" — answered without anyone reading an
 * ipconfig dump.
 *
 * WHY THIS SCRIPT EXISTS. Getting the field app onto a real handset failed
 * repeatedly, and never once for an interesting reason. The failures were:
 *
 *   1. THE WRONG IP. This machine has six IPv4 addresses. Four of them are
 *      Hyper-V switches, WSL bridges and the Windows Mobile Hotspot, and Vite
 *      prints all of them with equal billing at startup. Picking the wrong one
 *      gives a phone that hangs until it times out, which looks exactly like a
 *      firewall problem and gets debugged as one.
 *   2. THE IP CHANGED. Move between two Wi-Fi networks and the address moves
 *      with it. The URL that worked this morning now points at nothing, and
 *      the symptom is identical to the app being broken.
 *   3. TYPING IT. `https://192.168.1.18:3357/app` typed on a phone keyboard,
 *      by someone standing up, is a coin flip.
 *
 * So: work out which interface actually carries traffic, print that one URL,
 * and print it as a QR code the phone camera can just read. Point the camera,
 * tap the banner, done — the fastest thing available.
 *
 * Run it any time — `npm run phone` — including while the dev server is up.
 * It re-detects on every run, so a network change is one command, not a
 * debugging session.
 */

import os from 'node:os';
import dgram from 'node:dgram';
import QRCode from 'qrcode';

const PORT = Number(process.env.PORT_WEB) || 3357;
const PATH = '/app';

/**
 * The address the OS would actually send from.
 *
 * Asking the routing table beats every heuristic over interface names, because
 * it is the same decision the phone's traffic will be answered by. Connecting
 * a UDP socket sends nothing on the wire — it only binds a local address — so
 * this works with no internet connection at all.
 */
function routedAddress() {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    const done = (value) => {
      try {
        sock.close();
      } catch {
        /* already closed */
      }
      resolve(value);
    };
    sock.on('error', () => done(null));
    try {
      sock.connect(53, '8.8.8.8', () => {
        const addr = sock.address()?.address ?? null;
        done(addr && addr !== '0.0.0.0' ? addr : null);
      });
    } catch {
      done(null);
    }
    setTimeout(() => done(null), 700);
  });
}

/** Everything else, ranked, for when there is no route to the internet. */
function candidates() {
  const skip = /vEthernet|WSL|Default Switch|Loopback|VirtualBox|VMware|Bluetooth|TAP-Windows|OpenVPN/i;
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (a.address.startsWith('169.254.')) continue; // link-local: no DHCP
      out.push({
        name,
        address: a.address,
        // Hotspot and virtual adapters are real but almost never the answer.
        rank: skip.test(name) ? 3 : a.address.startsWith('192.168.137.') ? 2 : 0,
      });
    }
  }
  return out.sort((x, y) => x.rank - y.rank);
}

const routed = await routedAddress();
const list = candidates();
const ip = routed ?? list[0]?.address ?? null;

if (!ip) {
  console.error('\n  No usable network address found. Is Wi-Fi connected?\n');
  process.exit(1);
}

const url = `https://${ip}:${PORT}${PATH}`;

console.log('');
console.log('  ┌─────────────────────────────────────────────┐');
console.log('  │  Parking PV — open this on the phone        │');
console.log('  └─────────────────────────────────────────────┘');
console.log('');
console.log(`  ${url}`);
console.log('');

console.log(await QRCode.toString(url, { type: 'terminal', small: true }));

console.log('  Point the phone camera at the square above and tap the banner.');
console.log('');
console.log('  Two things that will still stop it, both one-time:');
console.log('');
console.log('   1. Windows Firewall. The phone is an INBOUND connection, and it is');
console.log('      blocked by default on a network marked "Public". In an ADMIN');
console.log('      PowerShell, once:');
console.log('');
console.log(`         New-NetFirewallRule -DisplayName "Parking PV dev ${PORT}" \``);
console.log(`           -Direction Inbound -Protocol TCP -LocalPort ${PORT} \``);
console.log('           -Action Allow -Profile Public,Private');
console.log('');
console.log('   2. The certificate warning. The dev server uses a self-signed cert,');
console.log('      so Safari says "This Connection Is Not Private". Tap Show Details,');
console.log('      then "visit this website". Do NOT switch to plain http — camera,');
console.log('      GPS and offline mode need a secure context.');
console.log('      NOTE: offline mode (the service worker) will NOT install over a');
console.log('      self-signed cert on Android or iPhone. Test offline on the deployed URL.');
console.log('');

if (list.length > 1) {
  const others = list.filter((c) => c.address !== ip);
  if (others.length) {
    console.log('  Ignore these — virtual adapters and the hotspot, not your Wi-Fi:');
    for (const c of others) console.log(`     ${c.address.padEnd(16)} ${c.name}`);
    console.log('');
  }
}

console.log('  The phone must be on the same Wi-Fi as this machine.');
console.log('');
