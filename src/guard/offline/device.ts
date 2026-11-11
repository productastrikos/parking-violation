/**
 * Device identity and small platform helpers.
 *
 * The device id is created once, on first launch, and kept in IndexedDB. The
 * dashboard's "which device is signed in" list is keyed on it, and every
 * record carries it — so two guards sharing one handset are still told apart
 * (by guard), and one guard with two phones is too (by device).
 */
import { kvGet, kvSet } from './db';

export function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // iOS < 15.4 has no randomUUID; build an RFC 4122 v4 id from getRandomValues.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function platformLabel(): { label: string; platform: string } {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const android = /Android/.test(ua);
  const os = ios ? (/iPad/.test(ua) ? 'iPad' : 'iPhone') : android ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : 'Device';
  const browser = /EdgA?\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const standalone = isStandalone() ? ' · app' : '';
  return { label: `${os} · ${browser}${standalone}`, platform: os };
}

export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

/** Running from the Home Screen icon (installed), rather than in a browser tab. */
export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

export interface DeviceInfo {
  deviceId: string;
  name: string; // guard-editable, e.g. "Gate 2 phone"
}

let cached: DeviceInfo | null = null;

export async function deviceInfo(): Promise<DeviceInfo> {
  if (cached) return cached;
  let d = await kvGet<DeviceInfo>('device');
  if (!d) {
    d = { deviceId: uuid(), name: '' };
    await kvSet('device', d);
  }
  cached = d;
  return d;
}

export async function renameDevice(name: string) {
  const d = await deviceInfo();
  cached = { ...d, name: name.trim().slice(0, 40) };
  await kvSet('device', cached);
}

export async function deviceLabel() {
  const d = await deviceInfo();
  return d.name || platformLabel().label;
}

/**
 * Ask the browser not to evict this app's storage under pressure. Chrome grants
 * it to installed apps; Safari treats Home Screen apps as persistent already.
 * Unsupported browsers simply return false — the app still works.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
