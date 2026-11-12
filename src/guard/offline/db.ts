/**
 * The phone's own database (IndexedDB) — where every violation lives from the
 * moment the guard taps Save until the server confirms it.
 *
 * Three stores:
 *   records  one row per violation, with its sync state and a small thumbnail
 *   photos   full-size photos, keyed `${recordId}:${kind}`, deleted after sync
 *   kv       device id, offline sign-in verifiers, current session, counters
 *
 * PHOTOS ARE STORED AS ArrayBuffer + mime type, not Blob. Older iOS Safari
 * versions failed to store Blobs in IndexedDB; ArrayBuffers work on every
 * iPhone and Android browser this app supports. They become Blobs again only
 * for the upload.
 */
import { openDB, type IDBPDatabase } from 'idb';
import type { Plate, Gps, Severity } from '../../lib/api';

export type SyncState = 'pending' | 'syncing' | 'synced' | 'rejected' | 'auth';

export interface LocalRecord {
  id: string;
  ref: string;
  type: string;
  severity: Severity;
  plate: Plate;
  location: { areaId: string; landmark: string; gps: Gps | null };
  notes: string;
  guardId: string;
  guardName: string;
  deviceId: string;
  deviceLabel: string;
  capturedAt: number;
  capturedOffline: boolean;
  thumb: string | null; // small data URL so lists render without loading full photos
  photoKinds: ('vehicle' | 'plate')[];
  syncState: SyncState;
  attempts: number;
  lastError?: string;
  syncedAt?: number;
  receivedAt?: number;
  editedAt?: number;
  /** What the control room did with it, mirrored from the server's field pack. */
  server?: { status: string; voided: boolean; voidReason?: string; edited: boolean; correction?: { state: string; reason: string } | null; plate?: Plate; type?: string; at: number };
  /** A mistake report waiting in the outbox (before the server has it). */
  correctionQueued?: { reason: string; at: number } | null;
  /** Penalty notice printed on this phone (a reprint says DUPLICATE COPY). Local only. */
  printedAt?: number;
  printCount?: number;
}

/** A change to a synced record, queued like a record so it works offline. */
export interface Op {
  id: string; // op id = idempotency key on the server
  kind: 'correction';
  violationId: string;
  guardId: string;
  reason: string;
  createdAt: number;
  state: 'pending' | 'done' | 'failed';
  lastError?: string;
}

/** An unfinished capture form, so a killed app or a phone call never loses a half-filled record. */
export interface Draft {
  userId: string;
  editingId?: string;
  fields: Record<string, unknown>;
  photos: { kind: 'vehicle' | 'plate'; buf: ArrayBuffer; type: string; at: number }[];
  savedAt: number;
}

export interface StoredPhoto {
  key: string;
  recordId: string;
  kind: 'vehicle' | 'plate';
  buf: ArrayBuffer;
  type: string;
}

let dbp: Promise<IDBPDatabase> | null = null;

export function db() {
  dbp ||= openDB('park-patrol', 2, {
    upgrade(d, oldVersion) {
      if (oldVersion < 1) {
        const r = d.createObjectStore('records', { keyPath: 'id' });
        r.createIndex('byState', 'syncState');
        r.createIndex('byCaptured', 'capturedAt');
        d.createObjectStore('photos', { keyPath: 'key' });
        d.createObjectStore('kv');
      }
      if (oldVersion < 2) d.createObjectStore('ops', { keyPath: 'id' });
    },
  });
  return dbp;
}

/* ── ops (corrections to synced records) ───────────────────────────────── */
export async function queueOp(op: Op) {
  const d = await db();
  const tx = d.transaction(['ops', 'records'], 'readwrite');
  await tx.objectStore('ops').put(op);
  const rec = (await tx.objectStore('records').get(op.violationId)) as LocalRecord | undefined;
  if (rec) await tx.objectStore('records').put({ ...rec, correctionQueued: { reason: op.reason, at: op.createdAt } });
  await tx.done;
}
export async function pendingOps(): Promise<Op[]> {
  return ((await (await db()).getAll('ops')) as Op[]).filter((o) => o.state === 'pending').sort((a, b) => a.createdAt - b.createdAt);
}
export async function updateOp(id: string, patch: Partial<Op>) {
  const d = await db();
  const cur = (await d.get('ops', id)) as Op | undefined;
  if (cur) await d.put('ops', { ...cur, ...patch });
}

/** Mirror the control room's decisions onto the phone's copies. */
export async function applyServerState(mine: { id: string; status: string; voided: boolean; voidReason?: string; edited: boolean; correction?: { state: string; reason: string } | null; plate?: Plate; type?: string }[]) {
  const d = await db();
  const tx = d.transaction('records', 'readwrite');
  let changed = false;
  for (const m of mine) {
    const rec = (await tx.store.get(m.id)) as LocalRecord | undefined;
    if (!rec) continue;
    const server = { status: m.status, voided: m.voided, voidReason: m.voidReason, edited: m.edited, correction: m.correction ?? null, plate: m.plate, type: m.type, at: Date.now() };
    if (JSON.stringify({ ...rec.server, at: 0 }) === JSON.stringify({ ...server, at: 0 })) continue;
    await tx.store.put({ ...rec, server, correctionQueued: m.correction ? null : rec.correctionQueued });
    changed = true;
  }
  await tx.done;
  return changed;
}

/* ── drafts ────────────────────────────────────────────────────────────── */
export const getDraft = (userId: string) => kvGet<Draft>(`draft:${userId}`);
export const saveDraft = (d: Draft) => kvSet(`draft:${d.userId}`, d);
export const clearDraft = (userId: string) => kvDel(`draft:${userId}`);

/** Replace an UNSYNCED record and its photos (guard edited it before upload). */
export async function replaceUnsynced(rec: LocalRecord, photos: Omit<StoredPhoto, 'key' | 'recordId'>[]) {
  const d = await db();
  const tx = d.transaction(['records', 'photos'], 'readwrite');
  const cur = (await tx.objectStore('records').get(rec.id)) as LocalRecord | undefined;
  if (cur && (cur.syncState === 'synced' || cur.syncState === 'syncing')) {
    await tx.done;
    throw new Error('This record was uploaded meanwhile — report a mistake instead of editing it');
  }
  for (const k of ['vehicle', 'plate']) await tx.objectStore('photos').delete(`${rec.id}:${k}`);
  await tx.objectStore('records').put(rec);
  for (const p of photos) await tx.objectStore('photos').put({ ...p, recordId: rec.id, key: `${rec.id}:${p.kind}` });
  await tx.done;
}

/* ── kv ─────────────────────────────────────────────────────────────────── */
export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await db()).get('kv', key) as Promise<T | undefined>;
}
export async function kvSet(key: string, value: unknown) {
  await (await db()).put('kv', value, key);
}
export async function kvDel(key: string) {
  await (await db()).delete('kv', key);
}

/* ── records ────────────────────────────────────────────────────────────── */
/** Save a new violation and its photos in ONE transaction — never a record without its photos. */
export async function saveRecord(rec: LocalRecord, photos: Omit<StoredPhoto, 'key' | 'recordId'>[]) {
  const d = await db();
  const tx = d.transaction(['records', 'photos'], 'readwrite');
  await tx.objectStore('records').put(rec);
  for (const p of photos) await tx.objectStore('photos').put({ ...p, recordId: rec.id, key: `${rec.id}:${p.kind}` });
  await tx.done;
}

export async function allRecords(): Promise<LocalRecord[]> {
  const list = (await (await db()).getAll('records')) as LocalRecord[];
  return list.sort((a, b) => b.capturedAt - a.capturedAt);
}

export async function getRecord(id: string) {
  return (await (await db()).get('records', id)) as LocalRecord | undefined;
}

export async function updateRecord(id: string, patch: Partial<LocalRecord>) {
  const d = await db();
  const tx = d.transaction('records', 'readwrite');
  const cur = (await tx.store.get(id)) as LocalRecord | undefined;
  if (cur) await tx.store.put({ ...cur, ...patch });
  await tx.done;
}

/** Only an unsynced record can be deleted from the phone — once it is on the server, it is evidence. */
export async function deleteUnsynced(id: string) {
  const d = await db();
  const tx = d.transaction(['records', 'photos'], 'readwrite');
  const cur = (await tx.objectStore('records').get(id)) as LocalRecord | undefined;
  if (cur && cur.syncState !== 'synced') {
    await tx.objectStore('records').delete(id);
    for (const k of cur.photoKinds) await tx.objectStore('photos').delete(`${id}:${k}`);
  }
  await tx.done;
}

export async function photosFor(id: string): Promise<StoredPhoto[]> {
  const d = await db();
  const out: StoredPhoto[] = [];
  for (const kind of ['vehicle', 'plate'] as const) {
    const p = (await d.get('photos', `${id}:${kind}`)) as StoredPhoto | undefined;
    if (p) out.push(p);
  }
  return out;
}

/** After a confirmed upload: mark synced and free the full-size photos (the thumbnail stays). */
export async function markSynced(id: string, receivedAt: number) {
  const d = await db();
  const tx = d.transaction(['records', 'photos'], 'readwrite');
  const cur = (await tx.objectStore('records').get(id)) as LocalRecord | undefined;
  if (cur) {
    await tx.objectStore('records').put({ ...cur, syncState: 'synced', syncedAt: Date.now(), receivedAt, lastError: undefined });
    for (const k of cur.photoKinds) await tx.objectStore('photos').delete(`${id}:${k}`);
  }
  await tx.done;
}

/** Device-local sequence for human-readable refs created offline. */
export async function nextSeq(): Promise<number> {
  const d = await db();
  const tx = d.transaction('kv', 'readwrite');
  const n = ((await tx.store.get('seq')) as number | undefined) ?? 0;
  await tx.store.put(n + 1, 'seq');
  await tx.done;
  return n + 1;
}

/** Synced records older than this are trimmed from the phone (the server keeps them). */
export async function pruneSynced(keepDays = 7) {
  const cutoff = Date.now() - keepDays * 86_400_000;
  const d = await db();
  const tx = d.transaction('records', 'readwrite');
  for (const r of (await tx.store.getAll()) as LocalRecord[]) if (r.syncState === 'synced' && r.capturedAt < cutoff) await tx.store.delete(r.id);
  await tx.done;
}
