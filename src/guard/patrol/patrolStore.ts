/**
 * The guard's patrol, on the phone (IndexedDB "kv" store — works offline).
 *
 *   routes:<guardId>   this guard's routes: from the route code scanned off the
 *                      dashboard (QR), or from the field pack when online.
 *   patrols            the patrol reports made on this phone (one per route per
 *                      day), with what was handed over and uploaded.
 *
 * A report is handed to the laptop like a ticket: as a picture over the USB
 * cable (patrolCard.ts). Online phones also upload it (sync.ts).
 */
import { useSyncExternalStore } from 'react';
import { kvGet, kvSet } from '../offline/db';
import { dayKey, type PatrolReport, type PatrolRoute, type VisitHow } from '../../lib/patrol';

export interface StoredRoutes {
  routes: PatrolRoute[];
  at: number;
  source: 'code' | 'server';
}
export interface LocalReport extends PatrolReport {
  updatedAt: number;
  cableExportedAt?: number;
  uploadedAt?: number;
}

let version = 0;
const listeners = new Set<() => void>();
const changed = () => {
  version += 1;
  listeners.forEach((l) => l());
};
/** Re-render on any patrol change: `usePatrolVersion()` in a component, then read. */
export const usePatrolVersion = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => version,
  );

/* ── routes ─────────────────────────────────────────────────────────────── */
export const getRoutes = (guardId: string) => kvGet<StoredRoutes>(`routes:${guardId}`);
export async function setRoutes(guardId: string, routes: PatrolRoute[], source: StoredRoutes['source']) {
  await kvSet(`routes:${guardId}`, { routes, at: Date.now(), source } satisfies StoredRoutes);
  changed();
}
/** Routes from the field pack (online): adopted unless a code scanned later is newer. */
export async function adoptServerRoutes(guardId: string, routes: PatrolRoute[] | undefined) {
  if (!routes) return;
  const cur = await getRoutes(guardId);
  const newest = Math.max(0, ...routes.map((r) => r.updatedAt));
  if (cur && cur.source === 'code' && cur.at > newest) return;
  if (cur && JSON.stringify(cur.routes) === JSON.stringify(routes)) return;
  await setRoutes(guardId, routes, 'server');
}

/* ── reports ────────────────────────────────────────────────────────────── */
/** One change at a time: two checkpoints reached together must not overwrite each other. */
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
}

export const allReports = async () => (await kvGet<LocalReport[]>('patrols')) ?? [];
async function saveAll(list: LocalReport[]) {
  // Keep two weeks on the phone; the laptop keeps the history.
  const cutoff = Date.now() - 14 * 86_400_000;
  await kvSet('patrols', list.filter((r) => r.startedAt >= cutoff));
  changed();
}
export async function reportFor(routeId: string, guardId: string, date = dayKey()) {
  return (await allReports()).find((r) => r.routeId === routeId && r.guardId === guardId && r.date === date) ?? null;
}

export const startPatrol = (route: PatrolRoute, guard: { id: string; name: string }, device: { deviceId: string; label: string }) => serial(() => startPatrolNow(route, guard, device));
async function startPatrolNow(route: PatrolRoute, guard: { id: string; name: string }, device: { deviceId: string; label: string }): Promise<LocalReport> {
  const existing = await reportFor(route.id, guard.id);
  if (existing) return existing;
  const now = Date.now();
  const rep: LocalReport = {
    id: crypto.randomUUID(),
    routeId: route.id,
    routeName: route.name,
    guardId: guard.id,
    guardName: guard.name,
    date: dayKey(now),
    startedAt: now,
    finishedAt: null,
    total: route.checkpoints.length,
    visits: [],
    deviceId: device.deviceId,
    deviceLabel: device.label,
    updatedAt: now,
  };
  await saveAll([rep, ...(await allReports())]);
  return rep;
}

const update = (id: string, patch: (r: LocalReport) => LocalReport | null) =>
  serial(async () => {
    const list = await allReports();
    const i = list.findIndex((r) => r.id === id);
    if (i < 0) return null;
    const next = patch(list[i]);
    if (!next) return list[i];
    list[i] = { ...next, updatedAt: Date.now() };
    await saveAll(list);
    return list[i];
  });

/** A checkpoint reached (first time only). */
export const markVisit = (id: string, cp: number, how: VisitHow) =>
  update(id, (r) => (r.visits.some((v) => v.cp === cp) ? null : { ...r, visits: [...r.visits, { cp, at: Date.now(), how }] }));
export const finishPatrol = (id: string) => update(id, (r) => (r.finishedAt ? null : { ...r, finishedAt: Date.now() }));
export const reopenPatrol = (id: string) => update(id, (r) => ({ ...r, finishedAt: null }));

/** Reports to hand to the laptop: started, and changed since the last picture. */
export async function reportsToHandOver() {
  return (await allReports()).filter((r) => r.visits.length > 0 && (!r.cableExportedAt || r.updatedAt > r.cableExportedAt));
}
export const markHandedOver = (ids: string[]) =>
  serial(async () => {
    const at = Date.now();
    const list = (await allReports()).map((r) => (ids.includes(r.id) ? { ...r, cableExportedAt: at } : r));
    await kvSet('patrols', list);
    changed();
  });
export async function reportsToUpload() {
  return (await allReports()).filter((r) => r.visits.length > 0 && (!r.uploadedAt || r.updatedAt > r.uploadedAt));
}
export const markUploaded = (id: string, at: number) =>
  serial(async () => {
    const list = (await allReports()).map((r) => (r.id === id ? { ...r, uploadedAt: at } : r));
    await kvSet('patrols', list);
    changed();
  });
