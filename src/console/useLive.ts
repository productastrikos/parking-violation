/**
 * The dashboard's live data: loaded over REST first (the floor), then kept
 * current by the socket (the enrichment). If the socket cannot connect, the
 * dashboard polls every 15 s, so it is never "working but empty", and the
 * header says honestly whether it is live.
 *
 * Also owns every write the dashboard makes (status, edit, void, restore,
 * correction, bulk) so pages never hand-roll requests, and the AI pack
 * (/api/intel) — refreshed every minute and shortly after records change.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import type { Notice } from '../lib/notice';
import { setFines, type FineSchedule } from '../lib/fines';
import { request, SOCKET_URL, type Device, type IntelPack, type Stats, type TeamRow, type Violation } from '../lib/api';

export interface EditChanges {
  type?: string;
  severity?: string;
  notes?: string;
  plate?: { emirate?: string; code?: string; number?: string };
  location?: { areaId?: string; landmark?: string };
}

export interface Live {
  violations: Violation[];
  stats: Stats | null;
  devices: Device[];
  team: TeamRow[];
  intel: IntelPack | null;
  live: boolean;
  loaded: boolean;
  error: string | null;
  fresh: Set<string>;
  token: string;
  reloadTeam: () => Promise<void>;
  refreshIntel: () => Promise<void>;
  setStatus: (id: string, status: string, note?: string) => Promise<void>;
  bulkStatus: (ids: string[], status: string) => Promise<number>;
  edit: (id: string, changes: EditChanges, reason: string) => Promise<Violation>;
  voidRecord: (id: string, reason: string) => Promise<void>;
  restore: (id: string) => Promise<void>;
  dismissCorrection: (id: string, note: string) => Promise<void>;
  plateCheck: (id: string) => Promise<void>;
  /** Log a print made from the dashboard (office copy, or the original if none was printed in the field). */
  logNoticePrint: (id: string, body: { notice: Notice; method: string }) => Promise<Violation>;
  saveFines: (changes: Record<string, number | null>, reason: string) => Promise<void>;
  reloadFines: () => Promise<void>;
}

export function useLive(token: string, onAuthLost: () => void): Live {
  const [violations, setViolations] = useState<Violation[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [team, setTeam] = useState<TeamRow[]>([]);
  const [intel, setIntel] = useState<IntelPack | null>(null);
  const [live, setLive] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const intelTimer = useRef<number | undefined>(undefined);

  const fail = useCallback(
    (e: unknown) => {
      const err = e as { status?: number; message: string };
      if (err.status === 401) onAuthLost();
      else setError(err.message);
    },
    [onAuthLost],
  );

  const load = useCallback(async () => {
    try {
      const [v, s, d, t] = await Promise.all([
        request<{ violations: Violation[] }>('/api/violations?limit=5000', { token }),
        request<Stats>('/api/stats', { token }),
        request<{ devices: Device[] }>('/api/devices', { token }),
        request<{ team: TeamRow[] }>('/api/team', { token }),
      ]);
      setViolations(v.violations);
      setStats(s);
      setDevices(d.devices);
      setTeam(t.team);
      setLoaded(true);
      setError(null);
    } catch (e) {
      fail(e);
    }
  }, [token, fail]);

  const refreshIntel = useCallback(async () => {
    try {
      setIntel(await request<IntelPack>('/api/intel', { token }));
    } catch {
      /* the advisory is enrichment — the dashboard works without it */
    }
  }, [token]);
  const intelSoon = useCallback(() => {
    clearTimeout(intelTimer.current);
    intelTimer.current = window.setTimeout(() => void refreshIntel(), 2500);
  }, [refreshIntel]);

  const reloadTeam = useCallback(async () => {
    const t = await request<{ team: TeamRow[] }>('/api/team', { token });
    setTeam(t.team);
  }, [token]);

  const upsert = useCallback((v: Violation) => setViolations((list) => (list.some((x) => x.id === v.id) ? list.map((x) => (x.id === v.id ? v : x)) : [v, ...list])), []);

  const reloadFines = useCallback(async () => setFines(await request<FineSchedule>('/api/fines', { token })), [token]);

  useEffect(() => {
    void load();
    void refreshIntel();
    void reloadFines().catch(() => {});
    const it = window.setInterval(() => void refreshIntel(), 60_000);
    const s = io(SOCKET_URL, { auth: { token, surface: 'console' }, reconnectionDelayMax: 5000 });
    s.on('connect', () => {
      setLive(true);
      void load(); // catch up on anything that arrived while disconnected
    });
    s.on('disconnect', () => setLive(false));
    s.on('auth:invalid', onAuthLost);
    s.on('devices:state', (p: { devices: Device[]; stats: Stats }) => {
      setDevices(p.devices);
      setStats(p.stats);
    });
    s.on('device:status', (p: { device: Device }) => {
      setDevices((list) => [p.device, ...list.filter((d) => d.deviceId !== p.device.deviceId)].sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0)));
      void reloadTeam().catch(() => {});
    });
    s.on('violation:created', (p: { violation: Violation; stats: Stats }) => {
      upsert(p.violation);
      setStats(p.stats);
      setFresh((f) => new Set(f).add(p.violation.id));
      setTimeout(
        () =>
          setFresh((f) => {
            const n = new Set(f);
            n.delete(p.violation.id);
            return n;
          }),
        9000,
      );
      void reloadTeam().catch(() => {});
      intelSoon();
    });
    s.on('violation:updated', (p: { violation: Violation; stats?: Stats }) => {
      upsert(p.violation);
      if (p.stats) setStats(p.stats);
      intelSoon();
    });
    s.on('stats', (p: { stats: Stats }) => setStats(p.stats));
    s.on('team:changed', () => void reloadTeam().catch(() => {}));
    s.on('fines:changed', (p: { fines: FineSchedule }) => setFines(p.fines));
    return () => {
      clearInterval(it);
      s.disconnect();
    };
  }, [token, load, reloadTeam, refreshIntel, intelSoon, onAuthLost, upsert]);

  // Poll only while the socket is down.
  useEffect(() => {
    if (live) return;
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [live, load]);

  const post = useCallback(
    async (path: string, body: unknown = {}) => {
      const r = await request<{ violation: Violation }>(path, { method: 'POST', token, body: JSON.stringify(body) });
      upsert(r.violation);
      intelSoon();
      return r.violation;
    },
    [token, upsert, intelSoon],
  );

  return {
    violations,
    stats,
    devices,
    team,
    intel,
    live,
    loaded,
    error,
    fresh,
    token,
    reloadTeam,
    refreshIntel,
    setStatus: async (id, status, note) => void (await post(`/api/violations/${id}/status`, { status, note })),
    bulkStatus: async (ids, status) => {
      const r = await request<{ updated: number }>('/api/violations/bulk-status', { method: 'POST', token, body: JSON.stringify({ ids, status }) });
      await load();
      intelSoon();
      return r.updated;
    },
    edit: async (id, changes, reason) => {
      const r = await request<{ violation: Violation }>(`/api/violations/${id}`, { method: 'PATCH', token, body: JSON.stringify({ changes, reason }) });
      upsert(r.violation);
      intelSoon();
      return r.violation;
    },
    voidRecord: async (id, reason) => void (await post(`/api/violations/${id}/void`, { reason })),
    restore: async (id) => void (await post(`/api/violations/${id}/restore`)),
    dismissCorrection: async (id, note) => void (await post(`/api/violations/${id}/correction/dismiss`, { note })),
    plateCheck: async (id) => void (await post(`/api/ai/plate-check/${id}`)),
    saveFines: async (changes, reason) => setFines(await request<FineSchedule>('/api/fines', { method: 'PUT', token, body: JSON.stringify({ changes, reason }) })),
    reloadFines,
    logNoticePrint: (id, body) => post(`/api/violations/${id}/notice`, { ...body, at: Date.now() }),
  };
}
