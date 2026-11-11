/**
 * Park Patrol backend — ONE process, ONE port: REST API + Socket.IO share the
 * same HTTP server (deployment_context.md: backend 4357, REST and WebSocket on
 * a single nginx block). The port comes from process.env.PORT.
 *
 * The contract that makes offline capture safe:
 *
 *   1. WRITES OVER REST. A guard's phone uploads each stored violation with
 *      POST /api/violations — record JSON + photos in ONE multipart request,
 *      so a record never arrives without its evidence.
 *   2. IDEMPOTENT BY ID. The phone creates the record id (a UUID) when the
 *      guard taps Save. Uploading the same id again returns the stored record
 *      with 200 instead of creating a second one. Flaky signal, retries and a
 *      response lost on the way back can therefore never duplicate a record.
 *   3. FAN-OUT OVER THE SOCKET. After a write, the dashboard is told over
 *      Socket.IO (`violation:created`) so the record appears within a second.
 *      The socket also carries device presence: which phone is online, who is
 *      signed in on it, and how many records it was holding when it came back.
 */
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import multer from 'multer';
import { Server as SocketServer } from 'socket.io';

import * as store from './lib/store.js';
import { VIOLATION_TYPES, SEVERITIES, EMIRATES, AREAS, CITY, STATUSES, typeById, areaById } from '../shared/catalog.js';

const PORT = Number(process.env.PORT) || 4357;
const CLOCK_SKEW_LIMIT = 2 * 60_000;

store.load();

const app = express();
/* `origin: true` reflects the caller's Origin: in production the web app is on
   parking.astrikos.xyz and this API on parking-api.astrikos.xyz. ⚠ Demo-grade:
   allow-list the two origins before anything that is not a demo. */
app.use(cors({ origin: true }));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(store.UPLOAD_DIR, { maxAge: '30d', immutable: true }));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, store.UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = (path.extname(file.originalname || '') || '.jpg').toLowerCase().replace(/[^.a-z0-9]/g, '');
      cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 2 },
  fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

/* ── auth ───────────────────────────────────────────────────────────────── */
const tokenOf = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();

function requireUser(req, res, next) {
  const user = store.userForToken(tokenOf(req));
  if (!user) return res.status(401).json({ error: 'Session expired — sign in again while online' });
  req.user = user;
  next();
}
const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Not permitted for your role' });
const console_ = requireRole('supervisor', 'admin');

/* ── meta ───────────────────────────────────────────────────────────────── */
app.get('/', (_req, res) => res.json({ service: 'park-patrol-api', status: 'ok', port: PORT }));
/* The phone's connectivity probe. `navigator.onLine` says "online" on any
   Wi-Fi, internet or not; only an answer from HERE means a sync can work. */
app.get('/api/health', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, at: Date.now() });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password, surface } = req.body ?? {};
  const user = store.findUser(username);
  if (!user || !store.checkPassword(password, user.passwordHash)) return res.status(401).json({ error: 'Wrong username or password' });
  if (user.active === false) return res.status(403).json({ error: 'This account is deactivated — contact your supervisor' });
  if (surface === 'console' && !['supervisor', 'admin'].includes(user.role)) return res.status(403).json({ error: 'The dashboard is for supervisors and admins — guards use the Park Patrol app' });
  if (surface === 'app' && user.role === 'admin') return res.status(403).json({ error: 'Admin accounts use the dashboard, not the field app' });
  const token = store.createSession(user, { surface: surface === 'console' ? 'console' : 'app' });
  store.audit('auth.login', user, { surface });
  res.json({ token, user: store.publicUser(user) });
});

app.get('/api/auth/me', requireUser, (req, res) => res.json({ user: store.publicUser(req.user) }));
app.post('/api/auth/logout', requireUser, (req, res) => {
  store.dropSession(tokenOf(req));
  res.json({ ok: true });
});

app.get('/api/reference', (_req, res) => res.json({ violationTypes: VIOLATION_TYPES, severities: SEVERITIES, emirates: EMIRATES, areas: AREAS, city: CITY, statuses: STATUSES }));

/* ── violations ─────────────────────────────────────────────────────────── */
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

app.post(
  '/api/violations',
  requireUser,
  upload.fields([{ name: 'vehicle', maxCount: 1 }, { name: 'plate', maxCount: 1 }]),
  (req, res) => {
    const files = req.files ?? {};
    const discard = () => Object.values(files).flat().forEach((f) => fs.rm(f.path, { force: true }, () => {}));
    let input;
    try {
      input = JSON.parse(req.body?.record ?? '{}');
    } catch {
      discard();
      return res.status(400).json({ error: 'record must be JSON' });
    }

    const id = str(input.id, 64);
    if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) {
      discard();
      return res.status(400).json({ error: 'Missing record id' });
    }

    // Idempotency first: a repeat of a stored record is a success, not an error.
    const existing = store.findViolation(id);
    if (existing) {
      discard();
      return res.status(200).json({ violation: existing, duplicate: true });
    }

    /* Validate on the server even though the app validates: retries, old app
       versions and modified clients all post here directly. */
    const type = typeById(input.type);
    const errors = [];
    if (!type) errors.push(`Unknown violation type "${input.type}"`);
    const plateNumber = str(input.plate?.number, 12).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!plateNumber && !files.vehicle?.length) errors.push('A plate number or a vehicle photo is required');
    if (type?.id === 'other' && str(input.notes).length < 3) errors.push('"Other" needs a short description in notes');
    const capturedAtDevice = num(input.capturedAt);
    if (!capturedAtDevice) errors.push('capturedAt is required');
    const areaId = str(input.location?.areaId, 40);
    if (areaId && !areaById(areaId)) errors.push(`Unknown area "${areaId}"`);
    if (errors.length) {
      discard();
      return res.status(422).json({ error: errors.join('; ') });
    }

    /* Phone clocks can be wrong. sentAt is the phone's clock at upload; the
       difference to ours is that phone's error, applied to the capture time. */
    const receivedAt = Date.now();
    const sentAt = num(input.sentAt) ?? receivedAt;
    const skew = receivedAt - sentAt;
    const capturedAt = Math.abs(skew) > CLOCK_SKEW_LIMIT ? capturedAtDevice + skew : capturedAtDevice;

    const gps = input.location?.gps;
    const photos = [];
    if (files.vehicle?.[0]) photos.push({ kind: 'vehicle', url: `/uploads/${files.vehicle[0].filename}` });
    if (files.plate?.[0]) photos.push({ kind: 'plate', url: `/uploads/${files.plate[0].filename}` });

    const violation = {
      id,
      ref: str(input.ref, 40) || `PV-${id.slice(0, 8).toUpperCase()}`,
      type: type.id,
      severity: SEVERITIES.some((s) => s.id === input.severity) ? input.severity : type.severity,
      plate: {
        emirate: EMIRATES.some((e) => e.id === input.plate?.emirate) ? input.plate.emirate : 'AD',
        code: str(input.plate?.code, 4).toUpperCase(),
        number: plateNumber,
        raw: str(input.plate?.raw, 40),
        source: input.plate?.source === 'ocr' ? 'ocr' : 'manual',
        confidence: num(input.plate?.confidence) ?? undefined,
      },
      location: {
        areaId,
        landmark: str(input.location?.landmark, 120),
        gps: gps && num(gps.lat) !== null && num(gps.lng) !== null ? { lat: num(gps.lat), lng: num(gps.lng), accuracy: num(gps.accuracy) ?? null } : null,
      },
      notes: str(input.notes, 600),
      photos,
      guardId: req.user.id,
      guardName: req.user.name,
      deviceId: str(input.deviceId, 64),
      deviceLabel: str(input.deviceLabel, 60),
      capturedAt,
      capturedAtDevice,
      capturedOffline: Boolean(input.capturedOffline),
      receivedAt,
      clockSkewMs: Math.abs(skew) > CLOCK_SKEW_LIMIT ? skew : 0,
      status: 'new',
      history: [
        { at: capturedAt, by: req.user.name, action: input.capturedOffline ? 'Captured on phone (offline)' : 'Captured on phone' },
        { at: receivedAt, by: 'Server', action: 'Received and stored' },
      ],
    };

    const { violation: saved, created } = store.insertViolation(violation);
    if (!created) discard();
    store.audit('violation.create', req.user, { id: saved.id, ref: saved.ref, offline: saved.capturedOffline });
    if (saved.deviceId) {
      const d = store.touchDevice(saved.deviceId, { lastSync: receivedAt });
      io.to('console').emit('device:status', { device: d });
    }
    io.to('console').emit('violation:created', { violation: saved, stats: store.stats() });
    res.status(created ? 201 : 200).json({ violation: saved, duplicate: !created });
  },
);

app.get('/api/violations', requireUser, console_, (req, res) => {
  const { status, type, guard, area, limit } = req.query;
  let list = store.violations();
  if (status) list = list.filter((v) => v.status === status);
  if (type) list = list.filter((v) => v.type === type);
  if (guard) list = list.filter((v) => v.guardId === guard);
  if (area) list = list.filter((v) => v.location?.areaId === area);
  list = [...list].sort((a, b) => b.receivedAt - a.receivedAt);
  res.json({ violations: list.slice(0, Math.min(Number(limit) || 500, 2000)) });
});

/* A guard may look up their OWN records (the phone's "Synced" list); the dashboard sees all. */
app.get('/api/violations/:id', requireUser, (req, res) => {
  const v = store.findViolation(req.params.id);
  if (!v || (req.user.role === 'guard' && v.guardId !== req.user.id)) return res.status(404).json({ error: 'Not found' });
  res.json({ violation: v });
});

app.post('/api/violations/:id/status', requireUser, console_, (req, res) => {
  const { status, note } = req.body ?? {};
  if (!STATUSES.some((s) => s.id === status)) return res.status(400).json({ error: 'Unknown status' });
  const v = store.setStatus(req.params.id, status, str(note, 300), req.user);
  io.to('console').emit('violation:updated', { violation: v, stats: store.stats() });
  res.json({ violation: v });
});

app.get('/api/stats', requireUser, console_, (_req, res) => res.json(store.stats()));
app.get('/api/devices', requireUser, console_, (_req, res) => res.json({ devices: store.devices() }));

app.get('/api/export.csv', requireUser, console_, (_req, res) => {
  const esc = (x) => `"${String(x ?? '').replace(/"/g, '""')}"`;
  const iso = (t) => (t ? new Date(t).toISOString() : '');
  const head = ['ref', 'type', 'severity', 'plate_emirate', 'plate_code', 'plate_number', 'area', 'landmark', 'lat', 'lng', 'guard', 'device', 'captured_at', 'received_at', 'captured_offline', 'status', 'notes'];
  const rows = store.violations().map((v) => [
    v.ref, typeById(v.type)?.label ?? v.type, v.severity, v.plate?.emirate, v.plate?.code, v.plate?.number,
    areaById(v.location?.areaId)?.label ?? '', v.location?.landmark, v.location?.gps?.lat, v.location?.gps?.lng,
    v.guardName, v.deviceLabel, iso(v.capturedAt), iso(v.receivedAt), v.capturedOffline ? 'yes' : 'no', v.status, v.notes,
  ].map(esc).join(','));
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="violations-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send([head.join(','), ...rows].join('\n'));
});

/* ── field team ─────────────────────────────────────────────────────────── */
app.get('/api/team', requireUser, console_, (_req, res) => res.json({ team: store.teamRows() }));

app.post('/api/team', requireUser, console_, (req, res) => {
  const { id, name, role, area, phone, password } = req.body ?? {};
  // Supervisors can add guards; only an admin can mint another supervisor or admin.
  if (role && role !== 'guard' && req.user.role !== 'admin') return res.status(403).json({ error: 'Only an admin can add supervisors or admins' });
  const user = store.createUser({ id, name, role: role || 'guard', area, phone, password }, req.user);
  io.to('console').emit('team:changed', {});
  res.status(201).json({ user: store.publicUser(user) });
});

app.patch('/api/team/:id', requireUser, console_, (req, res) => {
  const user = store.updateUser(req.params.id, req.body ?? {}, req.user);
  io.to('console').emit('team:changed', {});
  res.json({ user: store.publicUser(user) });
});

/* ── errors ─────────────────────────────────────────────────────────────── */
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) return res.status(413).json({ error: `Photo upload: ${err.message}` });
  const status = err.status || 500;
  if (status >= 500) console.error('[api]', err);
  res.status(status).json({ error: err.message || 'Server error' });
});

/* ── Socket.IO: dashboard fan-out + device presence ─────────────────────── */
const server = http.createServer(app);
const io = new SocketServer(server, { cors: { origin: true, credentials: true }, maxHttpBufferSize: 1e6 });

/** deviceId → number of open sockets (a phone can briefly hold two during a reconnect). */
const deviceSockets = new Map();

io.on('connection', (socket) => {
  const auth = socket.handshake.auth ?? {};
  const user = store.userForToken(auth.token);
  if (!user) {
    socket.emit('auth:invalid');
    return socket.disconnect(true);
  }

  if (auth.surface === 'console') {
    if (!['supervisor', 'admin'].includes(user.role)) return socket.disconnect(true);
    socket.join('console');
    socket.emit('devices:state', { devices: store.devices(), stats: store.stats() });
    return;
  }

  // A field device.
  const deviceId = String(auth.deviceId || '').slice(0, 64);
  if (!deviceId) return socket.disconnect(true);
  deviceSockets.set(deviceId, (deviceSockets.get(deviceId) ?? 0) + 1);

  const hello = (info = {}) => {
    const d = store.touchDevice(deviceId, {
      online: true,
      userId: user.id,
      userName: user.name,
      label: String(info.label ?? auth.label ?? 'Phone').slice(0, 60),
      platform: String(info.platform ?? auth.platform ?? '').slice(0, 40),
      appVersion: String(info.appVersion ?? auth.appVersion ?? '').slice(0, 20),
      pendingAtHello: Number(info.pending ?? auth.pending) || 0,
    });
    io.to('console').emit('device:status', { device: d });
  };
  hello();
  socket.on('device:hello', hello);

  socket.on('disconnect', () => {
    const left = (deviceSockets.get(deviceId) ?? 1) - 1;
    if (left > 0) return deviceSockets.set(deviceId, left);
    deviceSockets.delete(deviceId);
    const d = store.touchDevice(deviceId, { online: false });
    io.to('console').emit('device:status', { device: d });
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use — an older API is probably still running.\n  Run \`npm run preflight\` (or stop that process) and start again.\n`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => console.log(`[api] Park Patrol API + Socket.IO on :${PORT}`));

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    store.flushNow();
    process.exit(0);
  });
}
