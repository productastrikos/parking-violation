/**
 * Which build is running, and is there a newer one on the server?
 *
 * Every `npm run build` stamps a build id into the bundle (__BUILD_ID__) and
 * writes the same id to /version.json (served no-cache, never precached). Both
 * surfaces poll it, so a redeploy is noticed within minutes even in a tab that
 * stays open all day — and the id is shown in the UI, so "am I on the new
 * version?" has a visible answer.
 *
 * The service worker (offline mode for the guard app) is the other half: a new
 * worker waits until it is told to take over. activateWaitingWorker() tells it.
 */
declare const __BUILD_ID__: string;

export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

/** "11 Nov 18:42" from "2026-11-11T13:12:05Z" (shown in local time). */
export function buildLabel(id = BUILD_ID) {
  const d = new Date(id);
  if (Number.isNaN(d.getTime())) return id;
  return d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export async function latestBuild(): Promise<string | null> {
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = (await r.json()) as { build?: string };
    return typeof j.build === 'string' ? j.build : null;
  } catch {
    return null; // offline — try again later
  }
}

/** Calls onNew(id) once when the server has a different build. Checks every `everyMs`, on focus and on reconnect. */
export function watchVersion(onNew: (id: string) => void, everyMs = 3 * 60 * 1000) {
  if (BUILD_ID === 'dev') return () => {};
  let done = false;
  const check = async () => {
    if (done || !navigator.onLine) return;
    const id = await latestBuild();
    if (id && id !== BUILD_ID && !done) {
      done = true;
      onNew(id);
    }
  };
  const onVis = () => document.visibilityState === 'visible' && void check();
  const t = window.setInterval(() => void check(), everyMs);
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('online', check);
  window.setTimeout(() => void check(), 4000);
  return () => {
    done = true;
    clearInterval(t);
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('online', check);
  };
}

/**
 * Make a newly installed service worker take over now instead of waiting for
 * every tab to close. Used by the dashboard, which has no form to protect.
 */
export async function activateWaitingWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return;
    const skip = (w: ServiceWorker | null | undefined) => w?.postMessage({ type: 'SKIP_WAITING' });
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => w.state === 'installed' && skip(w));
    });
    skip(reg.waiting);
    await reg.update();
  } catch {
    /* no worker, or offline — nothing to do */
  }
}
