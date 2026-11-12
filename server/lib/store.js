/**
 * The server's single source of truth: users, sessions, devices, violations
 * and the audit log, persisted as one JSON document (server/data/store.json).
 *
 * Writes are debounced and ATOMIC (write a temp file, then rename), so a crash
 * mid-write never leaves half a file. Right for a POC; a Postgres table per
 * collection is the production shape and route handlers only ever call the
 * functions exported here, so that swap does not touch them.
 *
 * Differences from the MBKS store, on purpose:
 *   • passwords are scrypt hashes, never plain text;
 *   • SESSIONS ARE PERSISTED with a 30-day expiry. A guard may be offline for
 *     hours with records queued on the phone; if a server restart forgot their
 *     token, every one of those uploads would be rejected. Persisted sessions
 *     are what make "sync when you are back online" safe across restarts.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { SEED_USERS, SEED_PASSWORD, buildSeedViolations } from './seed.js';
import { VIOLATION_TYPES } from '../../shared/catalog.js';

const DATA_DIR = path.resolve(import.meta.dirname, '..', 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const SESSION_TTL = 30 * 86_400_000;
/** Bump when the SAMPLE data changes shape; on boot, seeded records are rebuilt
 *  (real records, users, sessions and devices are kept). v2: 14 days, area
 *  rhythms, repeat offenders and a duplicate pair for the advisory engine. */
const SEED_VERSION = 2;

let state = null;
let writeTimer = null;

/* ── passwords ─────────────────────────────────────────────────────────── */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${crypto.scryptSync(String(password), salt, 64).toString('hex')}`;
}
export function checkPassword(password, stored) {
  if (!stored?.startsWith('scrypt$')) return false;
  const [, salt, hash] = stored.split('$');
  const candidate = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

/* ── load / save ───────────────────────────────────────────────────────── */
function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function fresh() {
  return {
    users: SEED_USERS.map((u) => ({ ...u, active: true, passwordHash: hashPassword(SEED_PASSWORD), createdAt: Date.now(), createdBy: 'system' })),
    sessions: {},
    devices: {},
    violations: buildSeedViolations(),
    audit: [],
    seedVersion: SEED_VERSION,
  };
}

/** The sample schedule from the catalog — the starting point; supervisors/admins change it. */
const catalogFines = () => Object.fromEntries(VIOLATION_TYPES.map((t) => [t.id, { fine: t.fine ?? null, code: t.code ?? '' }]));

function migrate(s) {
  s.users ||= [];
  s.sessions ||= {};
  s.devices ||= {};
  s.violations ||= [];
  s.audit ||= [];
  s.fines ||= { schedule: {}, updatedAt: null, updatedBy: null, history: [] };
  // A violation type added to the catalog later gets its sample fine; amounts someone set are kept.
  for (const [id, e] of Object.entries(catalogFines())) s.fines.schedule[id] ??= e;
  if ((s.seedVersion ?? 1) < SEED_VERSION) {
    const real = s.violations.filter((v) => !v.seeded);
    s.violations = [...real, ...buildSeedViolations()].sort((a, b) => b.capturedAt - a.capturedAt);
    s.seedVersion = SEED_VERSION;
    console.log(`[store] sample data rebuilt (v${SEED_VERSION}); ${real.length} real records kept`);
  }
  for (const v of s.violations) {
    v.edits ??= [];
    v.voided ??= false;
  }
  // Adopt a seeded account the persisted store predates (never overwrite an edited one).
  for (const seeded of SEED_USERS) {
    if (!s.users.some((u) => u.id === seeded.id)) {
      s.users.push({ ...seeded, active: true, passwordHash: hashPassword(SEED_PASSWORD), createdAt: Date.now(), createdBy: 'system' });
    }
  }
  // Nothing is "online" at boot — sockets reconnect and say so.
  for (const d of Object.values(s.devices)) d.online = false;
  const now = Date.now();
  for (const [t, sess] of Object.entries(s.sessions)) if (sess.expiresAt < now) delete s.sessions[t];
  return s;
}

export function load() {
  ensureDirs();
  if (fs.existsSync(STORE_FILE)) {
    try {
      state = migrate(JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')));
      console.log(`[store] loaded ${state.violations.length} violations, ${state.users.length} users, ${Object.keys(state.devices).length} devices`);
      return state;
    } catch (err) {
      const bad = `${STORE_FILE}.corrupt-${Date.now()}`;
      fs.renameSync(STORE_FILE, bad);
      console.warn(`[store] store unreadable (${err.message}) — kept as ${path.basename(bad)}, reseeding`);
    }
  }
  state = migrate(fresh());
  flush();
  console.log(`[store] seeded ${state.violations.length} sample violations and ${state.users.length} accounts`);
  return state;
}

function flush() {
  ensureDirs();
  const tmp = `${STORE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, STORE_FILE);
}

function persist() {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(flush, 400);
}

/** Flush now — used on shutdown so a Ctrl+C right after a sync never loses it. */
export function flushNow() {
  clearTimeout(writeTimer);
  if (state) flush();
}

/* ── users & sessions ──────────────────────────────────────────────────── */
/** The ONE projection that decides what about a user is safe to send anywhere. */
export const publicUser = (u) =>
  u && { id: u.id, name: u.name, role: u.role, area: u.area ?? '', phone: u.phone ?? '', active: u.active !== false, createdAt: u.createdAt };

export const users = () => state.users;
export const findUser = (id) => state.users.find((u) => u.id === String(id || '').trim().toLowerCase());

export function createSession(user, meta = {}) {
  const token = crypto.randomBytes(24).toString('hex');
  state.sessions[token] = { userId: user.id, createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL, ...meta };
  persist();
  return token;
}

export function userForToken(token) {
  const s = token && state.sessions[token];
  if (!s) return null;
  if (s.expiresAt < Date.now()) {
    delete state.sessions[token];
    persist();
    return null;
  }
  const u = state.users.find((x) => x.id === s.userId);
  return u && u.active !== false ? u : null;
}

export function dropSession(token) {
  if (state.sessions[token]) {
    delete state.sessions[token];
    persist();
  }
}

export function createUser({ id, name, role = 'guard', area = '', phone = '', password }, actor) {
  const login = String(id || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,24}$/.test(login)) throw httpError(400, 'Login id: 3–24 characters, letters, digits, dot, dash or underscore');
  if (findUser(login)) throw httpError(409, `Login id "${login}" is already taken`);
  if (!String(name || '').trim()) throw httpError(400, 'Name is required');
  if (!['guard', 'supervisor', 'admin'].includes(role)) throw httpError(400, 'Unknown role');
  const user = {
    id: login,
    name: String(name).trim(),
    role,
    area,
    phone: String(phone || '').trim(),
    active: true,
    passwordHash: hashPassword(password || SEED_PASSWORD),
    createdAt: Date.now(),
    createdBy: actor?.id ?? 'system',
  };
  state.users.push(user);
  audit('user.create', actor, { id: user.id, role });
  return user;
}

export function updateUser(id, patch, actor) {
  const u = findUser(id);
  if (!u) throw httpError(404, 'No such user');
  for (const k of ['name', 'area', 'phone']) if (typeof patch[k] === 'string') u[k] = patch[k].trim();
  if (typeof patch.active === 'boolean') {
    if (u.id === actor?.id && !patch.active) throw httpError(400, 'You cannot deactivate your own account');
    u.active = patch.active;
    // A deactivated guard's sessions end now; anything still queued on their phone is held there.
    if (!u.active) for (const [t, s] of Object.entries(state.sessions)) if (s.userId === u.id) delete state.sessions[t];
  }
  if (patch.password) u.passwordHash = hashPassword(patch.password);
  audit('user.update', actor, { id: u.id, fields: Object.keys(patch).filter((k) => k !== 'password').concat(patch.password ? ['password'] : []) });
  return u;
}

/* ── devices ───────────────────────────────────────────────────────────── */
export const devices = () => Object.values(state.devices).sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));

export function touchDevice(deviceId, patch) {
  if (!deviceId) return null;
  const d = (state.devices[deviceId] ||= { deviceId, firstSeen: Date.now() });
  Object.assign(d, patch, { lastSeen: Date.now() });
  persist();
  return d;
}

/* ── violations ────────────────────────────────────────────────────────── */
export const violations = () => state.violations;
export const findViolation = (id) => state.violations.find((v) => v.id === id || v.ref === id);

/** Insert once. Returns { violation, created }. A repeat upload of the same id returns the stored record. */
export function insertViolation(v) {
  const existing = state.violations.find((x) => x.id === v.id);
  if (existing) return { violation: existing, created: false };
  state.violations.unshift(v);
  persist();
  return { violation: v, created: true };
}

export function setStatus(id, status, note, actor) {
  const v = findViolation(id);
  if (!v) throw httpError(404, 'No such violation');
  const from = v.status;
  v.status = status;
  v.history.push({ at: Date.now(), by: actor.name, action: `Status: ${from} → ${status}`, note: note || undefined });
  audit('violation.status', actor, { id: v.id, from, to: status });
  return v;
}

/* ── corrections: edit, void, restore, guard-reported mistakes ────────────
   A record is evidence, so nothing is ever deleted. An edit keeps the before
   and after of every field it changes plus the reason; a void hides the
   record from KPIs and fines but keeps it (and why) for the audit. */
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function editViolation(id, input, reason, actor, { typeIds, areaIds, emirateIds }) {
  const v = findViolation(id);
  if (!v) throw httpError(404, 'No such violation');
  const why = String(reason || '').trim();
  if (why.length < 3) throw httpError(400, 'Give a reason for the change (at least 3 characters)');
  if (v.voided) throw httpError(409, 'Restore the record before editing it');
  const changes = {};
  const set = (key, from, to, apply) => {
    if (!same(from, to)) {
      changes[key] = { from: from ?? null, to: to ?? null };
      apply();
    }
  };
  if (input.type !== undefined) {
    if (!typeIds.includes(input.type)) throw httpError(400, 'Unknown violation type');
    set('type', v.type, input.type, () => (v.type = input.type));
  }
  if (input.severity !== undefined) {
    if (!['low', 'medium', 'high'].includes(input.severity)) throw httpError(400, 'Unknown severity');
    set('severity', v.severity, input.severity, () => (v.severity = input.severity));
  }
  if (input.notes !== undefined) {
    const n = String(input.notes).trim().slice(0, 600);
    set('notes', v.notes, n, () => (v.notes = n));
  }
  if (input.plate) {
    const next = {
      emirate: emirateIds.includes(input.plate.emirate) ? input.plate.emirate : v.plate.emirate,
      code: String(input.plate.code ?? v.plate.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3),
      number: String(input.plate.number ?? v.plate.number ?? '').replace(/\D/g, '').slice(0, 5),
    };
    if (!next.number) throw httpError(400, 'The plate number cannot be empty');
    let changed = false;
    for (const k of ['emirate', 'code', 'number']) set(`plate.${k}`, v.plate[k], next[k], () => (changed = true));
    if (changed) v.plate = { ...v.plate, ...next, source: 'manual', correctedBy: actor.name };
  }
  if (input.location) {
    if (input.location.areaId && !areaIds.includes(input.location.areaId)) throw httpError(400, 'Unknown area');
    for (const k of ['areaId', 'landmark']) {
      if (input.location[k] === undefined) continue;
      const next = String(input.location[k]).trim().slice(0, 120);
      set(`location.${k}`, v.location[k], next, () => (v.location[k] = next));
    }
  }
  if (!Object.keys(changes).length) throw httpError(400, 'Nothing changed');
  const at = Date.now();
  v.edits.push({ at, by: actor.name, byId: actor.id, reason: why, changes });
  v.history.push({ at, by: actor.name, action: `Edited ${Object.keys(changes).join(', ')}`, note: why });
  v.updatedAt = at;
  audit('violation.edit', actor, { id: v.id, changes, reason: why });
  return v;
}

export function voidViolation(id, reason, actor) {
  const v = findViolation(id);
  if (!v) throw httpError(404, 'No such violation');
  const why = String(reason || '').trim();
  if (why.length < 3) throw httpError(400, 'Give a reason for voiding (at least 3 characters)');
  if (v.voided) return v;
  v.voided = true;
  v.voidedAt = Date.now();
  v.voidedBy = actor.name;
  v.voidReason = why.slice(0, 300);
  if (v.correction?.state === 'pending') v.correction = { ...v.correction, state: 'accepted', resolvedBy: actor.name, resolvedAt: v.voidedAt };
  v.history.push({ at: v.voidedAt, by: actor.name, action: 'Voided', note: v.voidReason });
  audit('violation.void', actor, { id: v.id, reason: v.voidReason });
  return v;
}

export function restoreViolation(id, actor) {
  const v = findViolation(id);
  if (!v) throw httpError(404, 'No such violation');
  if (!v.voided) return v;
  v.voided = false;
  v.history.push({ at: Date.now(), by: actor.name, action: 'Restored', note: `was voided: ${v.voidReason ?? ''}` });
  audit('violation.restore', actor, { id: v.id });
  return v;
}

/** A guard reports their OWN synced record as a mistake. Idempotent by opId — it may be retried from the phone's outbox. */
export function requestCorrection(id, { reason, opId }, actor) {
  const v = findViolation(id);
  if (!v || v.guardId !== actor.id) throw httpError(404, 'Not found');
  if (opId && v.correction?.opId === opId) return v;
  const why = String(reason || '').trim();
  if (why.length < 3) throw httpError(400, 'Say what is wrong with the record');
  v.correction = { state: 'pending', reason: why.slice(0, 300), opId, at: Date.now(), by: actor.name };
  v.history.push({ at: Date.now(), by: actor.name, action: 'Guard reported a mistake', note: v.correction.reason });
  audit('violation.correction', actor, { id: v.id, reason: v.correction.reason });
  return v;
}

export function dismissCorrection(id, note, actor) {
  const v = findViolation(id);
  if (!v?.correction) throw httpError(404, 'No correction request on this record');
  v.correction = { ...v.correction, state: 'dismissed', resolvedBy: actor.name, resolvedAt: Date.now(), note: String(note || '').slice(0, 300) };
  v.history.push({ at: Date.now(), by: actor.name, action: 'Correction request dismissed — record kept', note: note || undefined });
  audit('violation.correction.dismiss', actor, { id: v.id });
  return v;
}

/* ── penalty notices: every print, for accountability ──────────────────────
   A print is logged once (idempotent by opId — phones retry from their
   outbox) with WHO printed it, WHEN, on WHICH device and printer, and a
   snapshot of exactly what the paper says. The first print issues the fine:
   a New/Reviewed record moves to "Fine issued". */
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);
const txt = (x, max = 200) => String(x ?? '').trim().slice(0, max);
function cleanNotice(n = {}) {
  const l = n.layout ?? {};
  return {
    ref: txt(n.ref, 40),
    issuedAt: num(n.issuedAt),
    dueAt: num(n.dueAt),
    observedAt: num(n.observedAt),
    plate: { emirate: txt(n.plate?.emirate, 4), code: txt(n.plate?.code, 4), number: txt(n.plate?.number, 8) },
    typeId: txt(n.typeId, 40),
    typeLabel: txt(n.typeLabel, 120),
    code: txt(n.code, 16),
    fine: num(n.fine),
    details: n.details ? txt(n.details, 600) : undefined,
    areaLabel: txt(n.areaLabel, 120),
    landmark: txt(n.landmark, 120),
    gps: n.gps && num(n.gps.lat) != null ? { lat: num(n.gps.lat), lng: num(n.gps.lng), demo: Boolean(n.gps.demo) } : null,
    officerName: txt(n.officerName, 80),
    officerId: txt(n.officerId, 40),
    photos: num(n.photos) ?? 0,
    layout: { paper: num(l.paper) === 80 ? 80 : 58, authority: txt(l.authority, 120), department: txt(l.department, 120), footer: txt(l.footer, 800), payDays: num(l.payDays) ?? 30 },
    copy: ['original', 'duplicate', 'office'].includes(n.copy) ? n.copy : 'original',
    printedAt: num(n.printedAt) ?? undefined,
  };
}

export function recordNoticePrint(id, input, actor, surface) {
  const v = findViolation(id);
  if (!v || (actor.role === 'guard' && v.guardId !== actor.id)) throw httpError(404, 'Not found');
  v.notices ??= [];
  const opId = txt(input.opId, 64);
  if (opId && v.notices.some((p) => p.id === opId)) return v;
  const notice = cleanNotice(input.notice);
  if (!notice.issuedAt || !notice.ref) throw httpError(400, 'Notice details missing');
  // The first print anywhere is the original (it issues the fine); later ones are duplicates (phone) or office copies.
  const copy = v.notices.length === 0 ? 'original' : surface === 'dashboard' ? 'office' : 'duplicate';
  const at = Date.now();
  const p = {
    id: opId || crypto.randomUUID(),
    no: v.notices.length + 1,
    at: num(input.at) ?? at,
    receivedAt: at,
    copy,
    surface,
    byId: actor.id,
    by: actor.name,
    deviceId: txt(input.deviceId, 64) || undefined,
    deviceLabel: txt(input.deviceLabel, 80) || (surface === 'dashboard' ? 'Dashboard' : undefined),
    method: txt(input.method, 20),
    printer: txt(input.printer, 80) || undefined,
    notice: { ...notice, copy },
  };
  v.notices.push(p);
  const what = p.copy === 'original' ? 'Penalty notice issued & printed' : p.copy === 'office' ? 'Office copy of the notice printed' : 'Duplicate notice printed';
  const amount = notice.fine != null ? `AED ${notice.fine.toLocaleString('en-US')}` : 'amount to be assessed';
  v.history.push({ at: p.at, by: actor.name, action: what, note: `${notice.ref} · ${amount}${p.printer ? ` · ${p.printer}` : ''}` });
  // Handing the driver the notice IS issuing the fine.
  if (!v.voided && p.copy === 'original' && (v.status === 'new' || v.status === 'reviewed')) {
    const from = v.status;
    v.status = 'actioned';
    v.history.push({ at: p.at, by: actor.name, action: `Status: ${from} → actioned`, note: 'notice handed to the driver' });
  }
  v.updatedAt = at;
  audit('violation.notice', actor, { id: v.id, no: p.no, copy: p.copy, method: p.method, fine: notice.fine, surface });
  return v;
}

export function setAi(id, ai) {
  const v = findViolation(id);
  if (!v) return null;
  v.ai = { ...(v.ai ?? {}), ...ai };
  persist();
  return v;
}

/* ── fine schedule ──────────────────────────────────────────────────────── */
export const fines = (historyLimit = 50) => ({ schedule: state.fines.schedule, updatedAt: state.fines.updatedAt, updatedBy: state.fines.updatedBy, history: state.fines.history.slice(-historyLimit).reverse() });

/** Change fine amounts. changes: { [typeId]: number | null } (null = assessed later). Every change is kept. */
export function updateFines(changes, reason, actor) {
  const why = String(reason || '').trim();
  if (why.length < 3) throw httpError(400, 'Give a reason for the change (at least 3 characters)');
  const list = [];
  for (const [typeId, raw] of Object.entries(changes ?? {})) {
    const cur = state.fines.schedule[typeId];
    if (!cur) throw httpError(400, `Unknown violation type: ${typeId}`);
    const to = raw === null || raw === '' ? null : Number(raw);
    if (to !== null && (!Number.isFinite(to) || to < 0 || to > 100_000)) throw httpError(400, 'A fine must be between AED 0 and 100,000');
    const next = to === null ? null : Math.round(to * 100) / 100;
    if (next !== cur.fine) list.push({ typeId, from: cur.fine, to: next });
  }
  if (!list.length) throw httpError(400, 'Nothing changed');
  const at = Date.now();
  for (const c of list) state.fines.schedule[c.typeId] = { ...state.fines.schedule[c.typeId], fine: c.to };
  state.fines.history.push({ at, by: actor.name, byId: actor.id, role: actor.role, reason: why.slice(0, 300), changes: list });
  state.fines.updatedAt = at;
  state.fines.updatedBy = actor.name;
  audit('fines.update', actor, { changes: list, reason: why });
  return fines();
}

/** Start of "today" in the server's local time zone. */
const startOfDay = (t = Date.now()) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export function stats() {
  const today = startOfDay();
  const vs = state.violations.filter((v) => !v.voided);
  const todays = vs.filter((v) => v.capturedAt >= today);
  const byType = {};
  for (const v of todays) byType[v.type] = (byType[v.type] ?? 0) + 1;
  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const from = today - i * 86_400_000;
    const to = from + 86_400_000;
    last7.push({ day: from, count: vs.filter((v) => v.capturedAt >= from && v.capturedAt < to).length });
  }
  const ds = devices();
  const firstPrints = vs.map((v) => v.notices?.[0]).filter(Boolean);
  const issuedToday = firstPrints.filter((p) => p.at >= today);
  return {
    noticesToday: issuedToday.length,
    finesTodayAed: issuedToday.reduce((sum, p) => sum + (p.notice?.fine ?? 0), 0),
    noticesTotal: firstPrints.length,
    reprintsToday: vs.reduce((n, v) => n + (v.notices ?? []).filter((p) => p.copy !== 'original' && p.at >= today).length, 0),
    total: vs.length,
    today: todays.length,
    todayOffline: todays.filter((v) => v.capturedOffline).length,
    offlineTotal: vs.filter((v) => v.capturedOffline).length,
    awaitingReview: vs.filter((v) => v.status === 'new').length,
    corrections: vs.filter((v) => v.correction?.state === 'pending').length,
    voided: state.violations.length - vs.length,
    devicesOnline: ds.filter((d) => d.online).length,
    devicesTotal: ds.length,
    guardsActive: state.users.filter((u) => u.role === 'guard' && u.active !== false).length,
    byType,
    last7,
  };
}

/** Per-guard numbers for the Field Team page. */
export function teamRows() {
  const today = startOfDay();
  const ds = devices();
  return state.users.map((u) => {
    const mine = state.violations.filter((v) => v.guardId === u.id && !v.voided);
    const myDevices = ds.filter((d) => d.userId === u.id);
    const lastRecord = mine.reduce((m, v) => Math.max(m, v.capturedAt), 0) || null;
    return {
      ...publicUser(u),
      today: mine.filter((v) => v.capturedAt >= today).length,
      total: mine.length,
      offlineCaptured: mine.filter((v) => v.capturedOffline).length,
      noticesToday: mine.filter((v) => v.notices?.[0] && v.notices[0].at >= today && v.notices[0].byId === u.id).length,
      notices: mine.filter((v) => v.notices?.some((p) => p.byId === u.id && p.copy === 'original')).length,
      reprints: mine.reduce((n, v) => n + (v.notices ?? []).filter((p) => p.byId === u.id && p.copy === 'duplicate').length, 0),
      lastRecord,
      online: myDevices.some((d) => d.online),
      lastSeen: myDevices.reduce((m, d) => Math.max(m, d.lastSeen ?? 0), 0) || null,
      devices: myDevices.map((d) => ({ deviceId: d.deviceId, label: d.label, online: d.online, lastSeen: d.lastSeen, platform: d.platform })),
    };
  });
}

/* ── audit (append-only, hash-chained — from MBKS) ─────────────────────── */
const GENESIS = '0'.repeat(64);
const auditHash = (e, prev) =>
  crypto.createHash('sha256').update(`${prev}|${e.at}|${e.actorId}|${e.action}|${JSON.stringify(e.detail ?? {})}`).digest('hex');

export function audit(action, actor, detail = {}) {
  const prevHash = state.audit.length ? state.audit[state.audit.length - 1].hash : GENESIS;
  const entry = { seq: state.audit.length + 1, at: Date.now(), actorId: actor?.id ?? 'system', actorName: actor?.name ?? 'system', action, detail, prevHash };
  entry.hash = auditHash(entry, prevHash);
  state.audit.push(entry);
  persist();
  return entry;
}

export function auditVerify() {
  let prev = GENESIS;
  for (const e of state.audit) {
    if (e.prevHash !== prev || e.hash !== auditHash(e, prev)) return { ok: false, brokenAt: e.seq };
    prev = e.hash;
  }
  return { ok: true, entries: state.audit.length };
}

export function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
