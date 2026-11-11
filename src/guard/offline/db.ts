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
  dbp ||= openDB('park-patrol', 1, {
    upgrade(d) {
      const r = d.createObjectStore('records', { keyPath: 'id' });
      r.createIndex('byState', 'syncState');
      r.createIndex('byCaptured', 'capturedAt');
      d.createObjectStore('photos', { keyPath: 'key' });
      d.createObjectStore('kv');
    },
  });
  return dbp;
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
