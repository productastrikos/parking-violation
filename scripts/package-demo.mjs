/**
 * `npm run package` — the demo package: one zip anyone can install from.
 *
 *   ParkPatrol-Demo/
 *     START HERE.html            the install + demo guide (opens offline)
 *     Laptop - Windows/          double-click "Start Park Patrol.bat"   (Node.js inside)
 *     Laptop - macOS/            double-click "Start Park Patrol.command" (Node.js for Apple Silicon + Intel inside)
 *     Android/ParkPatrol.apk     the phone app — install by tapping it (build first: npm run android:build)
 *     iPhone/                    QR code to the web app (an iPhone cannot install an app from a zip)
 *
 * The laptop folders are self-contained: Node.js runtime + server + built web app
 * + the server's packages. Nothing is downloaded when they run; no internet needed.
 * Building the package needs internet once (server packages, macOS Node.js).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import QRCode from 'qrcode';

const root = path.resolve(import.meta.dirname, '..');
const rel = path.join(root, 'release');
const cache = path.join(rel, '.cache');
// Built in a private staging folder (and only that is ever deleted): a copy someone unzipped or is
// running — e.g. release/ParkPatrol-Demo — is never touched by a rebuild.
const out = path.join(rel, '.build', 'ParkPatrol-Demo');
const IPHONE_URL = process.env.IPHONE_URL || 'https://parking.astrikos.xyz:8443/app'; // the site is served on :8443 only
const NODE_VERSION = process.version; // the macOS runtimes match the Node.js this was built with (Windows reuses it as is)
const SERVER_DEPS = ['express', 'cors', 'compression', 'multer', 'socket.io'];

function run(cmd, args, cwd = root) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: true });
  if (r.status !== 0) throw new Error(`${cmd} failed (${r.status})`);
}
const write = (file, text, crlf = false) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, crlf ? text.replace(/\r?\n/g, '\r\n') : text);
};

/* 1 ── the web app for the laptop (same-origin API) ────────────────────────── */
run('node', ['scripts/fetch-map.mjs', '--if-missing']); // the built-in street map (fetched once)
run('npx', ['vite', 'build', '--mode', 'lan']);
const build = JSON.parse(fs.readFileSync(path.join(root, 'dist', 'version.json'), 'utf8')).build;

/* 2 ── the server's runtime packages (pure JavaScript: one copy runs on Windows and macOS) ── */
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const depsDir = path.join(cache, 'hub-deps');
const depsPkg = JSON.stringify({ name: 'park-patrol-hub', private: true, type: 'module', dependencies: Object.fromEntries(SERVER_DEPS.map((d) => [d, pkg.dependencies[d]])) }, null, 2);
if (!fs.existsSync(path.join(depsDir, 'node_modules')) || fs.readFileSync(path.join(depsDir, 'package.json'), 'utf8') !== depsPkg) {
  fs.rmSync(depsDir, { recursive: true, force: true });
  write(path.join(depsDir, 'package.json'), depsPkg);
  run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--ignore-scripts'], depsDir);
}

/* 3 ── macOS Node.js runtimes ───────────────────────────────────────────────── */
async function macNode(arch) {
  const tgz = path.join(cache, `node-${NODE_VERSION}-darwin-${arch}.tar.gz`);
  if (!fs.existsSync(tgz)) {
    const url = `https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-darwin-${arch}.tar.gz`;
    console.log(`> download ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download failed: ${url} (${res.status})`);
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
  }
  const x = path.join(cache, `x-${arch}`);
  fs.rmSync(x, { recursive: true, force: true });
  fs.mkdirSync(x, { recursive: true });
  const member = `node-${NODE_VERSION}-darwin-${arch}/bin/node`;
  run('tar', ['-xzf', `"${tgz}"`, '-C', `"${x}"`, member]);
  return path.join(x, member);
}

/* 4 ── assemble ─────────────────────────────────────────────────────────────── */
fs.rmSync(out, { recursive: true, force: true });
const isData = (p) => /[\\/]server[\\/]data([\\/]|$)/.test(p);
function appInto(dir) {
  fs.cpSync(path.join(root, 'server'), path.join(dir, 'server'), { recursive: true, filter: (p) => !isData(p) });
  fs.cpSync(path.join(root, 'shared'), path.join(dir, 'shared'), { recursive: true });
  fs.cpSync(path.join(root, 'dist'), path.join(dir, 'web'), { recursive: true });
  fs.cpSync(path.join(depsDir, 'node_modules'), path.join(dir, 'node_modules'), { recursive: true });
  write(path.join(dir, 'package.json'), JSON.stringify({ name: 'park-patrol-hub', private: true, type: 'module', version: pkg.version, build }, null, 2));
}

// Windows
const win = path.join(out, 'Laptop - Windows');
appInto(path.join(win, 'app'));
fs.mkdirSync(path.join(win, 'runtime'), { recursive: true });
fs.copyFileSync(process.execPath, path.join(win, 'runtime', 'node.exe'));
write(
  path.join(win, 'Start Park Patrol.bat'),
  `@echo off
title Park Patrol - laptop
rem Park Patrol laptop: double-click to start. The dashboard opens in your browser.
rem Close this window to stop. No internet needed.
cd /d "%~dp0"
set "PORT=4357"
set "HOST=127.0.0.1"
set "OPEN_BROWSER=1"
set "WEB_DIR=%~dp0app\\web"
set "DATA_DIR=%~dp0data"
"%~dp0runtime\\node.exe" "%~dp0app\\server\\index.js"
echo.
echo Park Patrol has stopped. Press any key to close this window.
pause >nul
`,
  true,
);
write(
  path.join(win, 'Reset demo data.bat'),
  `@echo off
rem Deletes this laptop's Park Patrol data (tickets, devices) - the next start reloads the sample tickets.
rem Stop Park Patrol first. Phones are not touched.
choice /m "Delete all Park Patrol data on this laptop and start fresh"
if errorlevel 2 exit /b
rmdir /s /q "%~dp0data" 2>nul
echo Done. Start Park Patrol again.
pause
`,
  true,
);

// macOS
const mac = path.join(out, 'Laptop - macOS');
appInto(path.join(mac, 'app'));
for (const arch of ['arm64', 'x64']) {
  const dst = path.join(mac, 'runtime', `node-${arch}`, 'node');
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(await macNode(arch), dst);
}
write(
  path.join(mac, 'Start Park Patrol.command'),
  `#!/bin/bash
# Park Patrol laptop: double-click to start. The dashboard opens in your browser.
# Close this Terminal window to stop. No internet needed.
cd "$(dirname "$0")" || exit 1
xattr -dr com.apple.quarantine . 2>/dev/null   # files from a downloaded zip are quarantined by macOS
if [ "$(uname -m)" = "arm64" ]; then NODE="runtime/node-arm64/node"; else NODE="runtime/node-x64/node"; fi
export PORT=4357 HOST=127.0.0.1 OPEN_BROWSER=1 WEB_DIR="$PWD/app/web" DATA_DIR="$PWD/data"
"$NODE" app/server/index.js
`,
);
write(
  path.join(mac, 'Reset demo data.command'),
  `#!/bin/bash
# Deletes this laptop's Park Patrol data (tickets, devices) - the next start reloads the sample tickets.
# Stop Park Patrol first. Phones are not touched.
cd "$(dirname "$0")" || exit 1
read -r -p "Delete all Park Patrol data on this laptop and start fresh? (y/N) " ok
[ "$ok" = "y" ] || [ "$ok" = "Y" ] || exit 0
rm -rf data && echo "Done. Start Park Patrol again."
`,
);

// Android
const apk = path.join(rel, 'ParkPatrol.apk');
const haveApk = fs.existsSync(apk);
if (haveApk) {
  fs.mkdirSync(path.join(out, 'Android'), { recursive: true });
  fs.copyFileSync(apk, path.join(out, 'Android', 'ParkPatrol.apk'));
} else console.warn('\n  ! release/ParkPatrol.apk missing — run `npm run android:build` first. Packaging without the Android app.\n');

// iPhone
fs.mkdirSync(path.join(out, 'iPhone'), { recursive: true });
await QRCode.toFile(path.join(out, 'iPhone', 'Scan in Chrome on the iPhone.png'), IPHONE_URL, { width: 640, margin: 2 });
write(path.join(out, 'iPhone', 'Web app address.txt'), `Open in Chrome on the iPhone:\n${IPHONE_URL}\n`, true);
const qr = await QRCode.toDataURL(IPHONE_URL, { width: 360, margin: 1 });

// The guide
const guide = fs.readFileSync(path.join(root, 'scripts', 'package-guide.html'), 'utf8')
  .replaceAll('{{BUILD}}', build)
  .replaceAll('{{IPHONE_URL}}', IPHONE_URL)
  .replaceAll('{{QR}}', qr)
  .replaceAll('{{APK_NOTE}}', haveApk ? '' : '<p class="warn">This copy of the package has no Android app — ask for the full package.</p>');
write(path.join(out, 'START HERE.html'), guide);

/* 5 ── zip (keeps the macOS execute permission on the start scripts and Node.js) ── */
function zipDir(srcDir, zipFile) {
  const base = path.basename(srcDir);
  const entries = [];
  (function walk(dir) {
    for (const d of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, d.name);
      const name = `${base}/${path.relative(srcDir, full).split(path.sep).join('/')}`;
      if (d.isDirectory()) {
        entries.push({ name: `${name}/`, dir: true });
        walk(full);
      } else entries.push({ name, full, exec: /\.command$/.test(d.name) || /\/runtime\/node-(arm64|x64)\/node$/.test(name) });
    }
  })(srcDir);

  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const fd = fs.openSync(zipFile, 'w');
  let offset = 0;
  const central = [];
  const put = (buf) => {
    fs.writeSync(fd, buf);
    offset += buf.length;
  };
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const data = e.dir ? Buffer.alloc(0) : fs.readFileSync(e.full);
    const crc = e.dir ? 0 : zlib.crc32(data);
    let method = 0;
    let body = data;
    if (data.length > 0) {
      const z = zlib.deflateRawSync(data, { level: 6 });
      if (z.length < data.length) {
        method = 8;
        body = z;
      }
    }
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    const at = offset;
    put(local);
    put(nameBuf);
    if (body.length) put(body);
    const mode = e.dir ? 0o40755 : e.exec ? 0o100755 : 0o100644;
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE((3 << 8) | 20, 4); // made by Unix → macOS keeps the permissions
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(method, 10);
    c.writeUInt16LE(dosTime, 12);
    c.writeUInt16LE(dosDate, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(body.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(nameBuf.length, 28);
    c.writeUInt32LE(((mode << 16) | (e.dir ? 0x10 : 0)) >>> 0, 38);
    c.writeUInt32LE(at, 42);
    central.push(Buffer.concat([c, nameBuf]));
  }
  const cdStart = offset;
  for (const c of central) put(c);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(offset - cdStart, 12);
  end.writeUInt32LE(cdStart, 16);
  put(end);
  fs.closeSync(fd);
  if (offset >= 0xffffffff || central.length >= 0xffff) throw new Error('zip too large for the simple writer');
  return central.length;
}

const zipFile = path.join(rel, 'ParkPatrol-Demo.zip');
const count = zipDir(out, zipFile);
console.log(`\nPackage ready: ${zipFile} — ${(fs.statSync(zipFile).size / 1048576).toFixed(0)} MB, ${count} entries, build ${build}${haveApk ? '' : ' (no Android app)'}\n`);
