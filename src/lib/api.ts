/**
 * The shared client contract: backend URLs, domain types, the catalogue and
 * one `request()` helper. Both surfaces (guard app and dashboard) import from
 * here; screens never hand-roll fetch URLs or auth headers.
 *
 * URLs come from env only. In development they are empty, so calls go to the
 * same origin and the Vite proxy forwards /api, /uploads and /socket.io. In
 * production `.env.production` points at the API subdomain.
 */
import * as catalog from '../../shared/catalog.js';
import { buildLabel } from './version';

const sameOrigin = () => (typeof window === 'undefined' ? '' : window.location.origin);
export const API_URL: string = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '');
export const SOCKET_URL: string = ((import.meta.env.VITE_SOCKET_URL as string | undefined) ?? '').replace(/\/$/, '') || API_URL || sameOrigin();
/** Shown in Settings and reported by each phone (Field Team page), so a redeploy can be confirmed per device. */
export const APP_VERSION = `1.1 · ${buildLabel()}`;

export const photoUrl = (p: string) => (/^(https?:|blob:|data:)/.test(p) ? p : `${API_URL}${p}`);

/* ── types ─────────────────────────────────────────────────────────────── */
export type Role = 'guard' | 'supervisor' | 'admin';
export type Severity = 'low' | 'medium' | 'high';
export type Status = 'new' | 'reviewed' | 'actioned' | 'dismissed';

export interface User {
  id: string;
  name: string;
  role: Role;
  area: string;
  phone: string;
  active: boolean;
  createdAt?: number;
}

export interface Plate {
  emirate: string;
  code: string;
  number: string;
  raw?: string;
  source: 'ocr' | 'manual';
  confidence?: number;
}

export interface Gps {
  lat: number;
  lng: number;
  accuracy: number | null;
  /** true when the position came from the labelled DEMO location, not a GPS receiver. */
  demo?: boolean;
}

export interface Violation {
  id: string;
  ref: string;
  type: string;
  severity: Severity;
  plate: Plate;
  location: { areaId: string; landmark: string; gps: Gps | null };
  notes: string;
  photos: { kind: 'vehicle' | 'plate'; url: string }[];
  guardId: string;
  guardName: string;
  deviceId: string;
  deviceLabel: string;
  capturedAt: number;
  capturedAtDevice?: number;
  capturedOffline: boolean;
  receivedAt: number;
  clockSkewMs: number;
  status: Status;
  history: { at: number; by: string; action: string; note?: string }[];
  edits?: { at: number; by: string; reason: string; changes: Record<string, { from: unknown; to: unknown }> }[];
  voided?: boolean;
  voidReason?: string;
  voidedBy?: string;
  voidedAt?: number;
  correction?: { state: 'pending' | 'accepted' | 'dismissed'; reason: string; at: number; by: string; resolvedBy?: string; note?: string } | null;
  ai?: {
    plateCheck?: { ok: boolean; readable?: boolean; read?: { emirate: string | null; code: string; number: string }; agrees?: boolean; confidence?: number | null; note?: string | null; model?: string; label?: string; at: number };
  };
  updatedAt?: number;
  seeded?: boolean;
}

/* ── intelligence (shared/intel.js) ────────────────────────────────────── */
export type AdvisoryPriority = 'critical' | 'high' | 'predictive' | 'medium' | 'info';
export interface Advisory {
  id: string;
  kind: string;
  priority: AdvisoryPriority;
  title: string;
  rootCause: string[];
  evidence: string[];
  actions: string[];
  impact: string;
  confidence: number;
  ids: string[];
  at: number;
  cta?: { label: string; action: 'open-record' | 'open-filter' | 'open-plate' | 'open-area' | 'open-team'; id?: string; filter?: string; plate?: string; areaId?: string };
}
export interface Hotspot {
  areaId: string;
  label: string;
  lat: number;
  lng: number;
  count7: number;
  prev7: number;
  trendPct: number;
  score: number;
  peakHour: number | null;
  peakWindow: string;
  topTypes: { id: string; label: string; n: number }[];
  high7: number;
}
export interface AreaForecast {
  areaId: string;
  label: string;
  next24: number;
  next3: number;
  peakHour: number;
  samples: number;
}
export interface Forecast {
  method: string;
  trendFactor: number;
  confidence: number;
  next24: number;
  hourly: { hour: number; expected: number }[];
  areas: AreaForecast[];
}
export interface Offender {
  key: string;
  plate: Plate;
  count: number;
  last: number;
  first?: number;
  types: Record<string, number>;
  areas?: Record<string, number>;
  ids?: string[];
  escalation: string;
}
export interface Anomaly {
  kind: string;
  tone: 'danger' | 'warning' | 'info';
  ids: string[];
  title: string;
  detail: string;
}
export interface IntelPack {
  engine: string;
  at: number;
  summary: string[];
  advisories: Advisory[];
  forecast: Forecast;
  hotspots: Hotspot[];
  offenders: Offender[];
  anomalies: Anomaly[];
  deployment: { need: (AreaForecast & { guards: number })[]; suggestions: { guardId: string; guardName: string; from: string; to: string; toAreaId: string; window: string; gain: number; reason: string }[] };
  hourProfile: number[];
  ai?: { ready: boolean; vision?: boolean; label?: string; model?: string; reason?: string };
}
export interface FieldPack {
  engine: string;
  at: number;
  area: string;
  outlook: (AreaForecast & { topTypes: { id: string; label: string; n: number }[]; trendPct: number; count7: number }) | null;
  hotspots: { areaId: string; label: string; count7: number; trendPct: number; peakWindow: string; topTypes: { id: string; label: string; n: number }[] }[];
  watchlist: Offender[];
  mine: { id: string; status: Status; voided: boolean; voidReason?: string; correction: Violation['correction']; edited: boolean; plate: Plate; type: string }[];
}

export interface Device {
  deviceId: string;
  label?: string;
  platform?: string;
  appVersion?: string;
  userId?: string;
  userName?: string;
  online?: boolean;
  lastSeen?: number;
  lastSync?: number;
  firstSeen?: number;
  pendingAtHello?: number;
  position?: { lat: number; lng: number; accuracy: number | null; demo: boolean; at: number };
}

export interface Stats {
  total: number;
  today: number;
  todayOffline: number;
  offlineTotal: number;
  awaitingReview: number;
  corrections: number;
  voided: number;
  devicesOnline: number;
  devicesTotal: number;
  guardsActive: number;
  byType: Record<string, number>;
  last7: { day: number; count: number }[];
}

export interface TeamRow extends User {
  today: number;
  total: number;
  offlineCaptured: number;
  lastRecord: number | null;
  online: boolean;
  lastSeen: number | null;
  devices: { deviceId: string; label?: string; online?: boolean; lastSeen?: number; platform?: string }[];
}

export interface ViolationType {
  id: string;
  label: string;
  short: string;
  severity: Severity;
  icon: string;
  /** Offence code printed on the notice. */
  code?: string;
  /** Fine in AED (sample schedule); null = assessed later. */
  fine?: number | null;
}
export interface Area {
  id: string;
  label: string;
  lat: number;
  lng: number;
}

/* ── catalogue (bundled copy of shared/catalog.js — works offline) ─────── */
export const VIOLATION_TYPES = catalog.VIOLATION_TYPES as ViolationType[];
export const AREAS = catalog.AREAS as Area[];
export const EMIRATES = catalog.EMIRATES as { id: string; label: string }[];
export const STATUSES = catalog.STATUSES as { id: Status; label: string }[];
export const CITY = catalog.CITY as { name: string; lat: number; lng: number; zoom: number };
export const typeOf = (id: string) => VIOLATION_TYPES.find((t) => t.id === id);
export const areaOf = (id: string) => AREAS.find((a) => a.id === id);
export const emirateOf = (id: string) => EMIRATES.find((e) => e.id === id);
export const statusLabel = (id: string) => STATUSES.find((s) => s.id === id)?.label ?? id;

/* ── request ───────────────────────────────────────────────────────────── */
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function request<T>(path: string, init: RequestInit & { token?: string; timeoutMs?: number } = {}): Promise<T> {
  const { token, timeoutMs = 20_000, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (rest.body && typeof rest.body === 'string') headers.set('Content-Type', 'application/json');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_URL}${path}`, { ...rest, headers, signal: ctrl.signal, cache: 'no-store' });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) throw new ApiError(res.status, (data as { error?: string } | null)?.error || `${res.status} ${res.statusText}`);
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}

/* ── formatting ────────────────────────────────────────────────────────── */
export const fmtTime = (t?: number | null) => (t ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');
export const fmtDate = (t?: number | null) => (t ? new Date(t).toLocaleDateString([], { day: '2-digit', month: 'short' }) : '—');
export const fmtDateTime = (t?: number | null) => (t ? `${fmtDate(t)}, ${fmtTime(t)}` : '—');

export function ago(t?: number | null, now = Date.now()) {
  if (!t) return 'never';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function duration(ms: number) {
  const m = Math.round(ms / 60000);
  if (m < 1) return '< 1 min';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

export const plateText = (p?: Plate) => (p ? [p.code, p.number].filter(Boolean).join(' ') || '—' : '—');
