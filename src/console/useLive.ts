/**
 * The dashboard's live data: loaded over REST first (the floor), then kept
 * current by the socket (the enrichment). If the socket cannot connect, the
 * dashboard polls every 15 s, so it is never "working but empty", and the
 * header says honestly whether it is live.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { request, SOCKET_URL, type Device, type Stats, type TeamRow, type Violation } from '../lib/api';

export interface Live {
  violations: Violation[];
  stats: Stats | null;
  devices: Device[];
  team: TeamRow[];
  live: boolean;
  loaded: boolean;
  error: string | null;
  fresh: Set<string>; // ids that arrived over the socket in the last few seconds
  reloadTeam: () => Promise<void>;
  setStatus: (id: string, status: string) => Promise<void>;
}

export function useLive(token: string, onAuthLost: () => void): Live {
  const [violations, setViolations] = useState<Violation[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [team, setTeam] = useState<TeamRow[]>([]);
  const [live, setLive] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const sockRef = useRef<Socket | null>(null);

  const load = useCallback(async () => {
    try {
      const [v, s, d, t] = await Promise.all([
        request<{ violations: Violation[] }>('/api/violations?limit=1000', { token }),
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
      const err = e as { status?: number; message: string };
      if (err.status === 401) onAuthLost();
      else setError(err.message);
    }
  }, [token, onAuthLost]);

  const reloadTeam = useCallback(async () => {
    const t = await request<{ team: TeamRow[] }>('/api/team', { token });
    setTeam(t.team);
  }, [token]);

  useEffect(() => {
    void load();
    const s = io(SOCKET_URL, { auth: { token, surface: 'console' }, reconnectionDelayMax: 5000 });
    sockRef.current = s;
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
      setViolations((list) => (list.some((x) => x.id === p.violation.id) ? list : [p.violation, ...list]));
      setStats(p.stats);
      setFresh((f) => new Set(f).add(p.violation.id));
      setTimeout(() => setFresh((f) => {
        const n = new Set(f);
        n.delete(p.violation.id);
        return n;
      }), 8000);
      void reloadTeam().catch(() => {});
    });
    s.on('violation:updated', (p: { violation: Violation; stats: Stats }) => {
      setViolations((list) => list.map((x) => (x.id === p.violation.id ? p.violation : x)));
      setStats(p.stats);
    });
    s.on('team:changed', () => void reloadTeam().catch(() => {}));
    return () => {
      s.disconnect();
      sockRef.current = null;
    };
  }, [token, load, reloadTeam, onAuthLost]);

  // Poll only while the socket is down.
  useEffect(() => {
    if (live) return;
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [live, load]);

  const setStatus = useCallback(
    async (id: string, status: string) => {
      const r = await request<{ violation: Violation }>(`/api/violations/${id}/status`, { method: 'POST', token, body: JSON.stringify({ status }) });
      setViolations((list) => list.map((x) => (x.id === id ? r.violation : x)));
    },
    [token],
  );

  return { violations, stats, devices, team, live, loaded, error, fresh, reloadTeam, setStatus };
}
