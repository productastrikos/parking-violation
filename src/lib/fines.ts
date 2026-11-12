/**
 * The fine schedule — what each violation costs. The SERVER owns it (an admin
 * on the dashboard or a supervisor in the app can change amounts, every change
 * logged with who, when and why). Each surface keeps the last copy it received
 * in localStorage, so a phone with no connection still prints the current
 * amount. Before the first sync, the sample schedule in shared/catalog.js is used.
 *
 * A notice already printed keeps the amount printed on it (its snapshot); a
 * schedule change only affects notices printed afterwards.
 */
import { useSyncExternalStore } from 'react';
import { VIOLATION_TYPES } from '../../shared/catalog.js';

export interface FineEntry {
  fine: number | null; // AED; null = amount assessed later
  code: string;
}
export interface FineChange {
  at: number;
  by: string;
  byId: string;
  role: string;
  reason: string;
  changes: { typeId: string; from: number | null; to: number | null }[];
}
export interface FineSchedule {
  schedule: Record<string, FineEntry>;
  updatedAt: number | null;
  updatedBy: string | null;
  history?: FineChange[];
}

export const FINE_EDITOR_ROLES = ['supervisor', 'admin'];
export const MAX_FINE = 100_000;

const KEY = 'pp.fines';
const fromCatalog = (): FineSchedule => ({
  schedule: Object.fromEntries((VIOLATION_TYPES as { id: string; code?: string; fine?: number | null }[]).map((t) => [t.id, { fine: t.fine ?? null, code: t.code ?? '' }])),
  updatedAt: null,
  updatedBy: null,
});

let cur: FineSchedule = (() => {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as FineSchedule;
  } catch {
    /* private mode */
  }
  return fromCatalog();
})();
const listeners = new Set<() => void>();

export const getFines = () => cur;
export function setFines(f: FineSchedule | null | undefined) {
  if (!f?.schedule) return;
  if (JSON.stringify(f) === JSON.stringify(cur)) return;
  cur = f;
  try {
    localStorage.setItem(KEY, JSON.stringify(f));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}
export const useFines = () =>
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => cur,
  );

export const fineFor = (typeId: string): FineEntry => cur.schedule[typeId] ?? fromCatalog().schedule[typeId] ?? { fine: null, code: '' };
