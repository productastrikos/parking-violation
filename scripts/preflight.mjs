/**
 * Make sure the two dev ports are actually ours before anything tries to bind
 * them.
 *
 * WHY THIS RUNS BEFORE EVERY `npm run dev`. A stale dev server surviving a
 * restart has now caused three separate bugs in this project, and not one of
 * them looked like what it was:
 *
 *   • The assistant returned 404 for an afternoon. An API process from the
 *     previous day still held the API port, and it predated the
 *     `/api/assistant/chat` route. The new API had died on EADDRINUSE inside
 *     `concurrently`, where the error scrolled past above the Vite banner.
 *   • The phone could not load the app. Vite found its port taken, printed
 *     "trying another one" and quietly moved one port up — so every URL anyone
 *     had written down, including the QR code, pointed at a closed port.
 *   • An `.env` change appeared to do nothing, because the process holding
 *     the port had read the file at boot, hours before the edit.
 *
 * The common shape: the failure is silent or misattributed, and the thing
 * that is wrong is never the thing being debugged. So this makes the state
 * explicit at the one moment it is cheap to fix — before startup.
 *
 * WHAT IT WILL AND WILL NOT KILL. Only a process that is (a) listening on
 * this project's two ports (3357 web / 4357 API by default, overridable with
 * PORT_WEB / BACKEND_PORT — the pair deployment_context.md assigns),
 * and (b) `node`. Anything else — another app that happens to want the port,
 * a database, an editor — is reported and left alone, and startup stops so a
 * person can decide. It never reaches for a PID it has not confirmed twice.
 */

import net from 'node:net';
import { execFileSync } from 'node:child_process';

const PORTS = [
  { port: Number(process.env.PORT_WEB) || 3357, what: 'Vite (web)' },
  { port: Number(process.env.BACKEND_PORT) || 4357, what: 'API + Socket.IO' },
];

const isWindows = process.platform === 'win32';

/** Can we bind `port` on this one address family? */
function bindTest(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    // No IPv6 on this machine (EAFNOSUPPORT / EADDRNOTAVAIL) is not "in use".
    server.once('error', (e) => resolve(e.code === 'EADDRINUSE' || e.code === 'EACCES'));
    server.once('listening', () => server.close(() => resolve(false)));
    server.listen({ port, host });
  });
}

/**
 * Is anything listening here? Bind-and-release is the only honest test — on
 * BOTH address families. Vite (`host: true`) listens dual-stack on [::], and
 * Windows lets a 0.0.0.0 bind succeed while [::]:3357 is held (an IPv6-only
 * test bind succeeds too). An IPv4-only check reported the port free, skipped
 * the clean-up, and Vite then died on EADDRINUSE inside `concurrently`. A
 * dual-stack bind on [::] — what Vite itself does — sees it.
 */
async function inUse(port) {
  return (await bindTest(port, '0.0.0.0')) || (await bindTest(port, '::'));
}

function sh(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

/** PIDs listening on `port`, whatever they belong to. */
function listenersOn(port) {
  if (isWindows) {
    const out = sh('netstat', ['-ano', '-p', 'TCP']);
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      // "  TCP    0.0.0.0:4357    0.0.0.0:0    LISTENING    12345"
      if (!/LISTENING/i.test(line)) continue;
      const cols = line.trim().split(/\s+/);
      const local = cols[1] ?? '';
      if (!local.endsWith(`:${port}`)) continue;
      const pid = Number(cols[cols.length - 1]);
      if (Number.isInteger(pid) && pid > 0) pids.add(pid);
    }
    return [...pids];
  }
  const out = sh('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']);
  return out.split(/\s+/).filter(Boolean).map(Number).filter((n) => Number.isInteger(n) && n > 0);
}

/** The executable name for a pid — the second half of the confirmation. */
function processName(pid) {
  if (isWindows) {
    const out = sh('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV']);
    const m = out.match(/^"([^"]+)"/m);
    return m ? m[1] : '';
  }
  return sh('ps', ['-p', String(pid), '-o', 'comm=']).trim();
}

function kill(pid) {
  if (isWindows) sh('taskkill', ['/PID', String(pid), '/F', '/T']);
  else {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let cleared = 0;
let blocked = false;

for (const { port, what } of PORTS) {
  if (!(await inUse(port))) continue;

  const pids = listenersOn(port);
  if (!pids.length) {
    console.error(`\n  Port ${port} (${what}) is in use, but the owning process could not be identified.`);
    console.error('  Close whatever is using it, or reboot, and try again.\n');
    blocked = true;
    continue;
  }

  for (const pid of pids) {
    const name = processName(pid);
    if (!/^node(\.exe)?$/i.test(name)) {
      console.error(`\n  Port ${port} (${what}) is held by ${name || 'an unknown process'} (pid ${pid}).`);
      console.error('  That is not one of ours, so nothing was stopped. Free the port and try again.\n');
      blocked = true;
      continue;
    }
    console.log(`  preflight: stopping stale ${what} on ${port} (node, pid ${pid})`);
    kill(pid);
    cleared += 1;
  }
}

if (blocked) process.exit(1);

if (cleared) {
  // Windows releases the socket a beat after the process dies; binding too
  // soon reproduces the exact error this script exists to prevent.
  await wait(900);
  for (const { port, what } of PORTS) {
    if (await inUse(port)) {
      console.error(`\n  Port ${port} (${what}) is still held after stopping the old process.`);
      console.error('  Wait a few seconds and run the command again.\n');
      process.exit(1);
    }
  }
  console.log(`  preflight: ${cleared} stale process${cleared === 1 ? '' : 'es'} cleared, ports ${PORTS.map((p) => p.port).join(' and ')} are free\n`);
}
