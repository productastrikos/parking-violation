/**
 * The sync engine: decides when the phone is REALLY online and uploads every
 * stored violation exactly once.
 *
 * WHEN IS THE PHONE ONLINE? Not when `navigator.onLine` says so — that is true
 * on any Wi-Fi, even one with no internet behind it. Online here means OUR
 * server answered GET /api/health within 3.5 s (or the socket is connected).
 *
 * WHEN DOES IT SYNC? The same way on Android and iPhone, while the app is open
 * or comes back to the foreground:
 *   • on app start, and whenever a record is saved;
 *   • the moment the OS reports a network change (`online` event);
 *   • when the socket (re)connects;
 *   • when the guard returns to the app (visibilitychange);
 *   • every 8 s while the app is visible (a cheap probe), so a network that
 *     came back without an event is still noticed;
 *   • when the guard taps "Sync now".
 * Background Sync (upload while the app is closed) exists only on Android
 * Chrome; it is deliberately not relied on, so both platforms behave the same.
 *
 * HOW? Oldest record first, one at a time, each as one multipart POST with its
 * photos. The server is idempotent by record id, so a retry after a lost
 * response is harmless. Outcomes:
 *   200/201  → synced; full photos deleted from the phone, thumbnail kept
 *   401      → this guard's token is no longer valid: the record stays on the
 *              phone (state "auth") until that guard signs in online again
 *   400/422  → rejected by validation: kept, shown to the guard with the reason
 *   other    → network or server trouble: stop, retry on the next trigger
 */
import { io, type Socket } from 'socket.io-client';
import { API_URL, SOCKET_URL, APP_VERSION, type Violation } from '../../lib/api';
import { allRecords, photosFor, markSynced, updateRecord, type LocalRecord } from './db';
import { credentialFor, invalidateToken, getSession } from './offlineAuth';
import { deviceInfo, deviceLabel, platformLabel } from './device';

export interface SyncStatus {
  online: boolean | null; // null = not checked yet
  socket: boolean;
  syncing: boolean;
  progress: { done: number; total: number } | null;
  pending: number; // waiting to upload (pending + auth)
  needsSignIn: string[]; // guard ids whose records wait for an online sign-in
  rejected: number;
  lastSyncAt: number | null;
  lastSyncCount: number;
  lastError: string | null;
  checkedAt: number | null;
}

let status: SyncStatus = {
  online: null,
  socket: false,
  syncing: false,
  progress: null,
  pending: 0,
  needsSignIn: [],
  rejected: 0,
  lastSyncAt: null,
  lastSyncCount: 0,
  lastError: null,
  checkedAt: null,
};
const listeners = new Set<() => void>();
const recordListeners = new Set<() => void>();

function set(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  listeners.forEach((l) => l());
}
export const getStatus = () => status;
export function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
/** Lists of records re-read when this fires (a save, a sync, a delete). */
export function onRecordsChanged(l: () => void) {
  recordListeners.add(l);
  return () => recordListeners.delete(l);
}
export function recordsChanged() {
  recordListeners.forEach((l) => l());
  void refreshCounts();
}

async function refreshCounts() {
  const recs = await allRecords();
  const waiting = recs.filter((r) => r.syncState === 'pending' || r.syncState === 'syncing' || r.syncState === 'auth');
  set({
    pending: waiting.length,
    needsSignIn: [...new Set(recs.filter((r) => r.syncState === 'auth').map((r) => r.guardId))],
    rejected: recs.filter((r) => r.syncState === 'rejected').length,
  });
  socket?.connected && sendHello();
}

/* ── connectivity probe ─────────────────────────────────────────────────── */
let lastKick = 0;
export async function probe(): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 3500);
  try {
    const res = await fetch(`${API_URL}/api/health?t=${Date.now()}`, { cache: 'no-store', signal: ctrl.signal });
    const ok = res.ok;
    set({ online: ok, checkedAt: Date.now() });
    // The server is reachable again: reconnect the live link now instead of waiting out Socket.IO's backoff.
    if (ok && socket && !socket.connected && Date.now() - lastKick > 5000) {
      lastKick = Date.now();
      socket.disconnect().connect(); // drop the pending backoff timer and dial now
    }
    return ok;
  } catch {
    set({ online: false, checkedAt: Date.now() });
    return false;
  } finally {
    clearTimeout(t);
  }
}

/* ── the upload loop ────────────────────────────────────────────────────── */
let running = false;
let again = false;

export async function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    do {
      again = false;
      await runOnce();
    } while (again);
  } finally {
    running = false;
  }
}

async function runOnce() {
  const queue = (await allRecords()).filter((r) => r.syncState === 'pending' || r.syncState === 'syncing').sort((a, b) => a.capturedAt - b.capturedAt);
  await refreshCounts();
  if (!(await probe())) return;
  if (!queue.length) return;

  set({ syncing: true, progress: { done: 0, total: queue.length }, lastError: null });
  let done = 0;
  let uploaded = 0;
  try {
    for (const rec of queue) {
      const outcome = await uploadOne(rec);
      if (outcome === 'stop') break;
      done += 1;
      if (outcome === 'ok') uploaded += 1;
      set({ progress: { done, total: queue.length } });
      recordsChanged();
    }
  } finally {
    set({ syncing: false, progress: null, ...(uploaded ? { lastSyncAt: Date.now(), lastSyncCount: uploaded } : {}) });
    recordsChanged();
  }
}

async function uploadOne(rec: LocalRecord): Promise<'ok' | 'skip' | 'stop'> {
  const cred = await credentialFor(rec.guardId);
  if (!cred?.token) {
    await updateRecord(rec.id, { syncState: 'auth', lastError: `${rec.guardName} must sign in online once to upload` });
    return 'skip';
  }
  await updateRecord(rec.id, { syncState: 'syncing', attempts: rec.attempts + 1 });

  const form = new FormData();
  form.append(
    'record',
    JSON.stringify({
      id: rec.id,
      ref: rec.ref,
      type: rec.type,
      severity: rec.severity,
      plate: rec.plate,
      location: rec.location,
      notes: rec.notes,
      deviceId: rec.deviceId,
      deviceLabel: rec.deviceLabel,
      capturedAt: rec.capturedAt,
      capturedOffline: rec.capturedOffline,
      sentAt: Date.now(), // lets the server measure this phone's clock error
    }),
  );
  for (const p of await photosFor(rec.id)) form.append(p.kind, new Blob([p.buf], { type: p.type }), `${p.kind}.jpg`);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45_000);
  try {
    const res = await fetch(`${API_URL}/api/violations`, { method: 'POST', body: form, headers: { Authorization: `Bearer ${cred.token}` }, signal: ctrl.signal });
    const body = (await res.json().catch(() => ({}))) as { violation?: Violation; error?: string };
    if (res.ok && body.violation) {
      await markSynced(rec.id, body.violation.receivedAt);
      return 'ok';
    }
    if (res.status === 401) {
      await invalidateToken(rec.guardId);
      await updateRecord(rec.id, { syncState: 'auth', lastError: `${rec.guardName} must sign in online once to upload` });
      return 'skip';
    }
    if (res.status === 400 || res.status === 413 || res.status === 422) {
      await updateRecord(rec.id, { syncState: 'rejected', lastError: body.error || `Rejected (${res.status})` });
      return 'skip';
    }
    await updateRecord(rec.id, { syncState: 'pending', lastError: body.error || `Server error ${res.status}` });
    set({ lastError: body.error || `Server error ${res.status}` });
    return 'stop';
  } catch {
    // Network dropped mid-upload. The record stays pending; the server may or may not have it —
    // the next attempt sends the same id, so either way there is exactly one record.
    await updateRecord(rec.id, { syncState: 'pending', lastError: 'Connection lost during upload — will retry' });
    set({ online: false });
    return 'stop';
  } finally {
    clearTimeout(timer);
  }
}

/** After an online sign-in, records parked in "auth" for that guard go back into the queue. */
export async function requeueFor(guardId: string) {
  for (const r of await allRecords()) if (r.syncState === 'auth' && r.guardId === guardId) await updateRecord(r.id, { syncState: 'pending', lastError: undefined });
  recordsChanged();
}

/** A rejected record the guard has corrected is queued again. */
export async function retryRecord(id: string) {
  await updateRecord(id, { syncState: 'pending', lastError: undefined });
  recordsChanged();
  void syncNow();
}

/* ── socket: device presence ────────────────────────────────────────────── */
let socket: Socket | null = null;

async function sendHello() {
  if (!socket?.connected) return;
  const d = await deviceInfo();
  socket.emit('device:hello', { deviceId: d.deviceId, label: await deviceLabel(), platform: platformLabel().platform, appVersion: APP_VERSION, pending: status.pending });
}

export async function connectSocket() {
  const session = await getSession();
  if (!session) return;
  const cred = await credentialFor(session.user.id);
  if (!cred?.token) return;
  const d = await deviceInfo();
  const label = await deviceLabel();
  socket?.disconnect();
  socket = io(SOCKET_URL, {
    // Read on every (re)connect, so the server always gets the current pending count.
    auth: (cb) => cb({ token: cred.token, surface: 'app', deviceId: d.deviceId, label, platform: platformLabel().platform, appVersion: APP_VERSION, pending: status.pending }),
    reconnectionDelay: 1500,
    reconnectionDelayMax: 4000,
    timeout: 6000,
  });
  socket.on('connect', () => {
    set({ socket: true, online: true });
    void syncNow();
  });
  socket.on('disconnect', () => set({ socket: false }));
  socket.on('auth:invalid', () => void invalidateToken(session.user.id));
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
  set({ socket: false });
}

/* ── triggers ───────────────────────────────────────────────────────────── */
let started = false;
export function startSyncEngine() {
  if (started) return;
  started = true;
  window.addEventListener('online', () => void syncNow());
  window.addEventListener('offline', () => set({ online: false }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow();
  });
  // iOS fires pageshow (not visibilitychange) when a Home Screen app is resumed from the app switcher.
  window.addEventListener('pageshow', () => void syncNow());
  setInterval(() => {
    if (document.visibilityState === 'visible') void syncNow();
  }, 8000);
  void syncNow();
}
