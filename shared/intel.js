/**
 * The intelligence engine — hotspots, forecasts, repeat offenders, anomalies,
 * deployment advice and the advisories built from them.
 *
 * DETERMINISTIC FIRST (JBVNL P26). Every number here is computed from the
 * live records with formulas a supervisor can argue with: no latency, no cost,
 * works offline on the phone, and the same answer twice. A language model,
 * when configured, only WRITES the brief from these numbers (server/index.js
 * /api/intel/brief) and double-checks plates from photos — it never invents a
 * count and never changes a record on its own.
 *
 * Shared by the server (dashboard advisory, field pack for the phones) and
 * the guard app (plate check against the cached watchlist, offline).
 *
 * Every advisory follows the Astrikos advisory shape (theme §10, MBKS
 * advisories.ts): title, root cause, evidence, ranked actions, impact,
 * confidence — so each ranking explains itself and a person decides.
 */
import { VIOLATION_TYPES, AREAS } from './catalog.js';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const SEV_WEIGHT = { high: 3, medium: 2, low: 1 };

export const ENGINE = 'Rules-based · from live records';

const live = (vs) => vs.filter((v) => !v.voided);
const typeLabel = (id) => VIOLATION_TYPES.find((t) => t.id === id)?.short ?? id;
const areaLabel = (id) => AREAS.find((a) => a.id === id)?.label ?? (id || 'Unknown area');
const hourLabel = (h) => `${String(h).padStart(2, '0')}:00`;
const pct = (a, b) => (b === 0 ? (a > 0 ? 100 : 0) : Math.round(((a - b) / b) * 100));

export const plateKey = (p) => (p && p.number ? `${p.emirate || 'AD'}|${(p.code || '').toUpperCase()}|${p.number}` : '');
export const plateText = (p) => (p ? [p.emirate, p.code, p.number].filter(Boolean).join(' ') : '');

function startOfDay(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/* ── repeat offenders ──────────────────────────────────────────────────── */
/** Plates with 2+ live violations, most frequent first. */
export function repeatOffenders(violations, now = Date.now()) {
  const by = new Map();
  for (const v of live(violations)) {
    const k = plateKey(v.plate);
    if (!k) continue;
    const e = by.get(k) ?? { key: k, plate: v.plate, count: 0, last: 0, first: Infinity, types: {}, areas: {}, ids: [], highCount: 0 };
    e.count += 1;
    e.last = Math.max(e.last, v.capturedAt);
    e.first = Math.min(e.first, v.capturedAt);
    e.types[v.type] = (e.types[v.type] ?? 0) + 1;
    if (v.location?.areaId) e.areas[v.location.areaId] = (e.areas[v.location.areaId] ?? 0) + 1;
    if (v.severity === 'high') e.highCount += 1;
    e.ids.push(v.id);
    by.set(k, e);
  }
  return [...by.values()]
    .filter((e) => e.count >= 2)
    .map((e) => ({
      ...e,
      escalation: e.count >= 4 || e.highCount >= 2 ? 'Clamp or tow on next sighting' : e.count >= 3 ? 'Fine at higher tier + warning notice' : 'Written warning',
      recentDays: Math.round((now - e.last) / DAY),
    }))
    .sort((a, b) => b.count - a.count || b.last - a.last);
}

/** Everything known about one plate — used by the phone while the guard types it. */
export function plateHistory(watchlist, plate) {
  const k = plateKey(plate);
  if (!k) return null;
  return watchlist.find((w) => w.key === k) ?? null;
}

/* ── hotspots & time profile ───────────────────────────────────────────── */
export function hourProfile(violations, days = 14, now = Date.now()) {
  const from = now - days * DAY;
  const h = Array(24).fill(0);
  for (const v of live(violations)) if (v.capturedAt >= from) h[new Date(v.capturedAt).getHours()] += 1;
  return h.map((n) => n / days);
}

export function hotspots(violations, now = Date.now()) {
  const vs = live(violations);
  const w7 = now - 7 * DAY;
  const w14 = now - 14 * DAY;
  const out = [];
  for (const a of AREAS) {
    const mine = vs.filter((v) => v.location?.areaId === a.id);
    const last7 = mine.filter((v) => v.capturedAt >= w7);
    const prev7 = mine.filter((v) => v.capturedAt >= w14 && v.capturedAt < w7);
    if (!last7.length && !prev7.length) continue;
    const types = {};
    const hours = Array(24).fill(0);
    let score = 0;
    for (const v of last7) {
      types[v.type] = (types[v.type] ?? 0) + 1;
      hours[new Date(v.capturedAt).getHours()] += 1;
      score += SEV_WEIGHT[v.severity] ?? 1;
    }
    const peak = hours.indexOf(Math.max(...hours));
    const topTypes = Object.entries(types)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 3)
      .map(([id, n]) => ({ id, label: typeLabel(id), n }));
    out.push({
      areaId: a.id,
      label: a.label,
      lat: a.lat,
      lng: a.lng,
      count7: last7.length,
      prev7: prev7.length,
      trendPct: pct(last7.length, prev7.length),
      score,
      peakHour: last7.length ? peak : null,
      peakWindow: last7.length ? `${hourLabel(peak)}–${hourLabel((peak + 2) % 24)}` : '—',
      topTypes,
      high7: last7.filter((v) => v.severity === 'high').length,
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

/* ── forecast ──────────────────────────────────────────────────────────── */
/**
 * Expected violations for the next 24 hours, by area and by hour.
 *
 * Method (stated on screen): the hour-of-day rate over the last 14 days, per
 * area, scaled by a recent-trend factor (last 3 days vs the 14-day mean,
 * clamped to 0.6–1.6). Confidence grows with the number of records behind it.
 * It is a staffing guide, not a promise — and the screen says so.
 */
export function forecast(violations, now = Date.now()) {
  const vs = live(violations);
  const days = 14;
  const from = now - days * DAY;
  const recent = vs.filter((v) => v.capturedAt >= from);
  const last3 = recent.filter((v) => v.capturedAt >= now - 3 * DAY).length / 3;
  const mean = recent.length / days;
  const trend = mean ? Math.min(1.6, Math.max(0.6, last3 / mean)) : 1;
  const startHour = new Date(now).getHours();

  const city = Array(24).fill(0);
  const areas = [];
  for (const a of AREAS) {
    const mine = recent.filter((v) => v.location?.areaId === a.id);
    if (!mine.length) continue;
    const prof = Array(24).fill(0);
    for (const v of mine) prof[new Date(v.capturedAt).getHours()] += 1 / days;
    const hourly = Array.from({ length: 24 }, (_, i) => prof[(startHour + i) % 24] * trend);
    hourly.forEach((x, i) => (city[i] += x));
    const next24 = hourly.reduce((s, x) => s + x, 0);
    const next3 = hourly.slice(0, 3).reduce((s, x) => s + x, 0);
    const peakIdx = hourly.indexOf(Math.max(...hourly));
    areas.push({
      areaId: a.id,
      label: a.label,
      next24: Math.round(next24 * 10) / 10,
      next3: Math.round(next3 * 10) / 10,
      peakHour: (startHour + peakIdx) % 24,
      samples: mine.length,
    });
  }
  areas.sort((x, y) => y.next24 - x.next24);
  const total = city.reduce((s, x) => s + x, 0);
  return {
    method: 'Hour-of-day rate per area over 14 days × recent-trend factor (last 3 days vs 14-day mean)',
    trendFactor: Math.round(trend * 100) / 100,
    confidence: Math.min(90, 35 + Math.round(recent.length * 0.8)),
    next24: Math.round(total),
    hourly: city.map((x, i) => ({ hour: (startHour + i) % 24, expected: Math.round(x * 10) / 10 })),
    areas,
  };
}

/* ── anomalies ─────────────────────────────────────────────────────────── */
export function anomalies(violations, { devices = [], users = [] } = {}, now = Date.now()) {
  const vs = live(violations);
  const out = [];

  // Same plate, same area, within 30 minutes — probably recorded twice.
  const sorted = [...vs].filter((v) => plateKey(v.plate)).sort((a, b) => a.capturedAt - b.capturedAt);
  const seen = new Map();
  for (const v of sorted) {
    const k = `${plateKey(v.plate)}@${v.location?.areaId ?? ''}`;
    const prev = seen.get(k);
    if (prev && v.capturedAt - prev.capturedAt < 30 * 60_000 && v.type === prev.type) {
      out.push({ kind: 'duplicate', tone: 'warning', ids: [prev.id, v.id], title: `Possible duplicate: ${plateText(v.plate)} recorded twice in ${Math.max(1, Math.round((v.capturedAt - prev.capturedAt) / 60_000))} min`, detail: `${typeLabel(v.type)} · ${areaLabel(v.location?.areaId)} · ${prev.ref} and ${v.ref}` });
    }
    seen.set(k, v);
  }

  for (const v of vs) {
    if (Math.abs(v.clockSkewMs || 0) > 2 * 60_000 && now - v.receivedAt < 7 * DAY)
      out.push({ kind: 'clock', tone: 'info', ids: [v.id], title: `Phone clock off by ${Math.round(Math.abs(v.clockSkewMs) / 60_000)} min on ${v.deviceLabel || 'a device'}`, detail: `${v.ref}: capture time corrected by the server. Ask ${v.guardName} to set the phone to automatic time.` });
  }

  const longWaits = vs.filter((v) => v.capturedOffline && v.receivedAt - v.capturedAt > 2 * HOUR && now - v.receivedAt < 3 * DAY);
  if (longWaits.length) {
    const byArea = {};
    for (const v of longWaits) byArea[v.location?.areaId ?? ''] = (byArea[v.location?.areaId ?? ''] ?? 0) + 1;
    const [area, n] = Object.entries(byArea).sort((a, b) => b[1] - a[1])[0];
    out.push({ kind: 'coverage', tone: 'info', ids: longWaits.map((v) => v.id), title: `${longWaits.length} record${longWaits.length > 1 ? 's' : ''} waited 2 h+ on a phone before upload`, detail: `Most in ${areaLabel(area)} (${n}). Likely a mobile-coverage gap — consider a Wi-Fi point at the guard post.` });
  }

  const corrections = vs.filter((v) => v.correction?.state === 'pending');
  for (const v of corrections)
    out.push({ kind: 'correction', tone: 'danger', ids: [v.id], title: `${v.guardName} reports ${v.ref} as a mistake`, detail: `"${v.correction.reason}" — review and void or keep.` });

  const unreviewedHigh = vs.filter((v) => v.status === 'new' && v.severity === 'high' && now - v.receivedAt > HOUR);
  if (unreviewedHigh.length)
    out.push({ kind: 'backlog', tone: 'danger', ids: unreviewedHigh.map((v) => v.id), title: `${unreviewedHigh.length} high-severity violation${unreviewedHigh.length > 1 ? 's' : ''} unreviewed for over an hour`, detail: unreviewedHigh.slice(0, 3).map((v) => `${v.ref} ${typeLabel(v.type)}`).join(' · ') });

  for (const d of devices) {
    if ((d.pendingAtHello ?? 0) >= 5) out.push({ kind: 'backlog-device', tone: 'warning', ids: [], title: `${d.label} reconnected holding ${d.pendingAtHello} records`, detail: `${d.userName ?? 'Guard'} was offline for a while; the records have been uploading since.` });
  }

  const today = startOfDay(now);
  if (new Date(now).getHours() >= 11) {
    for (const u of users.filter((x) => x.role === 'guard' && x.active !== false)) {
      const recs = vs.filter((v) => v.guardId === u.id && v.capturedAt >= today).length;
      const seenToday = devices.some((d) => d.userId === u.id && (d.lastSeen ?? 0) >= today);
      if (!recs && !seenToday) out.push({ kind: 'inactive', tone: 'info', ids: [], title: `${u.name} has not been active today`, detail: `No device seen and no records since midnight (${areaLabel(u.area)}).` });
    }
  }
  return out;
}

/* ── deployment ────────────────────────────────────────────────────────── */
/** Which guard should cover which area next, from the forecast. */
export function deployment(fc, users = [], devices = []) {
  const guards = users.filter((u) => u.role === 'guard' && u.active !== false);
  const coverage = {};
  for (const g of guards) coverage[g.area] = (coverage[g.area] ?? 0) + 1;
  const need = fc.areas.slice(0, 6).map((a) => ({ ...a, guards: coverage[a.areaId] ?? 0, perGuard: a.next24 / Math.max(1, coverage[a.areaId] ?? 0) }));
  const uncovered = need.filter((a) => !a.guards && a.next24 >= 1);
  const suggestions = [];
  for (const target of uncovered.slice(0, 2)) {
    // Move the guard whose own area expects the least.
    const donor = guards
      .map((g) => ({ g, load: fc.areas.find((a) => a.areaId === g.area)?.next24 ?? 0, online: devices.some((d) => d.userId === g.id && d.online) }))
      .filter((x) => !suggestions.some((s) => s.guardId === x.g.id))
      .sort((a, b) => a.load - b.load || Number(b.online) - Number(a.online))[0];
    if (!donor || donor.load >= target.next24) continue;
    suggestions.push({
      guardId: donor.g.id,
      guardName: donor.g.name,
      from: areaLabel(donor.g.area),
      to: target.label,
      toAreaId: target.areaId,
      window: hourLabel(target.peakHour),
      gain: Math.round((target.next24 - donor.load) * 10) / 10,
      reason: `${target.label} expects ~${target.next24} violations in 24 h with no guard assigned; ${areaLabel(donor.g.area)} expects ~${donor.load}.`,
    });
  }
  return { need, suggestions };
}

/* ── advisories ────────────────────────────────────────────────────────── */
export const PRIORITY_RANK = { critical: 0, high: 1, predictive: 2, medium: 3, info: 4 };

export function supervisorAdvisories({ violations, devices = [], users = [] }, now = Date.now()) {
  const vs = live(violations);
  const fc = forecast(vs, now);
  const hs = hotspots(vs, now);
  const offenders = repeatOffenders(vs, now);
  const an = anomalies(vs, { devices, users }, now);
  const dep = deployment(fc, users, devices);
  const out = [];

  for (const a of an.filter((x) => x.kind === 'correction'))
    out.push({ id: `corr-${a.ids[0]}`, kind: 'correction', priority: 'critical', title: a.title, rootCause: ['A guard flagged their own record as recorded by mistake.', 'Until reviewed, it still counts in the KPIs and could lead to a wrong fine.'], evidence: [a.detail], actions: ['Open the record and void it if the guard is right', 'Or keep it and dismiss the request with a note'], impact: 'Prevents a fine being issued on a mistaken record.', confidence: 95, ids: a.ids, at: now, cta: { label: 'Review record', action: 'open-record', id: a.ids[0] } });

  const backlog = an.find((x) => x.kind === 'backlog');
  if (backlog)
    out.push({ id: 'backlog-high', kind: 'backlog', priority: 'critical', title: backlog.title, rootCause: ['Fire lanes, People-of-Determination bays and wrong-way driving are safety cases.', 'They were received more than an hour ago and are still New.'], evidence: [backlog.detail], actions: ['Review and issue fines on the high-severity queue first', 'Dispatch a tow for fire-lane cases still in place'], impact: 'Safety-critical cases dealt with inside the hour.', confidence: 92, ids: backlog.ids, at: now, cta: { label: 'Open queue', action: 'open-filter', filter: 'high-new' } });

  for (const o of offenders.filter((x) => x.count >= 3).slice(0, 3))
    out.push({ id: `offender-${o.key}`, kind: 'offender', priority: 'high', title: `Repeat offender ${plateText(o.plate)} — ${o.count} violations`, rootCause: [`The same vehicle has been recorded ${o.count} times since ${new Date(o.first).toLocaleDateString([], { day: '2-digit', month: 'short' })}.`, `Mostly ${Object.entries(o.types).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${typeLabel(t)} ×${n}`).join(', ')}.`], evidence: [`Areas: ${Object.keys(o.areas).map(areaLabel).join(', ')}`, `Last seen ${o.recentDays === 0 ? 'today' : `${o.recentDays} d ago`}`], actions: [o.escalation, 'Guards are warned automatically when this plate is entered on a phone'], impact: 'Escalation targets the few vehicles behind a large share of repeat cases.', confidence: 88, ids: o.ids, at: now, cta: { label: 'Show records', action: 'open-plate', plate: o.key } });

  for (const a of an.filter((x) => x.kind === 'duplicate').slice(0, 3))
    out.push({ id: `dup-${a.ids.join('-')}`, kind: 'duplicate', priority: 'high', title: a.title, rootCause: ['Same plate, same violation and same area within 30 minutes.', 'Usually two guards or a retake — fining twice would be challenged.'], evidence: [a.detail], actions: ['Open both and void the duplicate', 'Keep both only if the vehicle was moved and re-parked'], impact: 'Avoids double fines and keeps the counts honest.', confidence: 80, ids: a.ids, at: now, cta: { label: 'Compare', action: 'open-record', id: a.ids[1] } });

  const surge = fc.areas.filter((a) => a.next3 >= 1).slice(0, 2);
  for (const s of surge) {
    const h = hs.find((x) => x.areaId === s.areaId);
    out.push({ id: `surge-${s.areaId}`, kind: 'forecast', priority: 'predictive', title: `${s.label}: ~${s.next3} violations expected in the next 3 hours`, rootCause: [`Peak around ${hourLabel(s.peakHour)} on the last 14 days' pattern.`, h ? `Last 7 days: ${h.count7} (${h.trendPct >= 0 ? '+' : ''}${h.trendPct}% vs the week before), mostly ${h.topTypes.map((t) => t.label).join(', ')}.` : 'Based on recent records.'], evidence: [`Forecast confidence ${fc.confidence}% · trend factor ×${fc.trendFactor}`], actions: [`Keep a guard in ${s.label} from ${hourLabel(s.peakHour)}`, h?.topTypes[0] ? `Brief them on ${h.topTypes[0].label.toLowerCase()} cases` : 'Brief the guard on the usual cases'], impact: 'Presence during the peak deters violations instead of only recording them.', confidence: fc.confidence, ids: [], at: now, cta: { label: 'Show on map', action: 'open-area', areaId: s.areaId } });
  }

  for (const s of dep.suggestions)
    out.push({ id: `deploy-${s.guardId}`, kind: 'deployment', priority: 'medium', title: `Move ${s.guardName} to ${s.to} around ${s.window}`, rootCause: [s.reason], evidence: [`Expected gain ≈ ${s.gain} more violations covered in 24 h`], actions: [`Reassign ${s.guardName} from ${s.from} to ${s.to} for the peak`, 'Revert after the peak window'], impact: 'Same team, better placed.', confidence: Math.max(50, fc.confidence - 10), ids: [], at: now, cta: { label: 'Field team', action: 'open-team' } });

  for (const a of an.filter((x) => ['coverage', 'clock', 'backlog-device', 'inactive'].includes(x.kind)).slice(0, 4))
    out.push({ id: `${a.kind}-${a.title}`, kind: a.kind, priority: a.kind === 'coverage' ? 'medium' : 'info', title: a.title, rootCause: [a.detail], evidence: [], actions: [a.kind === 'clock' ? 'Ask the guard to turn on automatic date & time' : a.kind === 'inactive' ? 'Check in with the guard' : 'Check mobile coverage in that area'], impact: '', confidence: 70, ids: a.ids, at: now, cta: a.ids[0] ? { label: 'Open', action: 'open-record', id: a.ids[0] } : undefined });

  return out.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
}

/** One compact pack for the dashboard. */
export function intelPack({ violations, devices = [], users = [] }, now = Date.now()) {
  const vs = live(violations);
  const fc = forecast(vs, now);
  const hs = hotspots(vs, now);
  const offenders = repeatOffenders(vs, now);
  const an = anomalies(vs, { devices, users }, now);
  const advisories = supervisorAdvisories({ violations: vs, devices, users }, now);
  const dep = deployment(fc, users, devices);
  const hp = hourProfile(vs, 14, now);
  const peak = hp.indexOf(Math.max(...hp));
  const summary = [
    `~${fc.next24} violations expected in the next 24 h${fc.areas[0] ? `, most in ${fc.areas[0].label} (~${fc.areas[0].next24})` : ''}.`,
    hs[0] ? `Top hotspot this week: ${hs[0].label} — ${hs[0].count7} records (${hs[0].trendPct >= 0 ? '+' : ''}${hs[0].trendPct}% week on week), peak ${hs[0].peakWindow}.` : 'Not enough records yet for hotspots.',
    offenders.length ? `${offenders.length} repeat-offender plate${offenders.length > 1 ? 's' : ''}; the worst has ${offenders[0].count} violations.` : 'No repeat offenders yet.',
    `City-wide peak hour: ${hourLabel(peak)}.`,
  ];
  return { engine: ENGINE, at: now, summary, advisories, forecast: fc, hotspots: hs, offenders: offenders.slice(0, 50), anomalies: an, deployment: dep, hourProfile: hp };
}

/** What a guard's phone caches for offline use: their area's outlook and the plate watchlist. */
export function fieldPack({ violations }, user, now = Date.now()) {
  const vs = live(violations);
  const fc = forecast(vs, now);
  const hs = hotspots(vs, now);
  const mine = fc.areas.find((a) => a.areaId === user?.area);
  const myHot = hs.find((h) => h.areaId === user?.area);
  return {
    engine: ENGINE,
    at: now,
    area: user?.area ?? '',
    outlook: mine ? { ...mine, topTypes: myHot?.topTypes ?? [], trendPct: myHot?.trendPct ?? 0, count7: myHot?.count7 ?? 0 } : null,
    hotspots: hs.slice(0, 5).map((h) => ({ areaId: h.areaId, label: h.label, count7: h.count7, trendPct: h.trendPct, peakWindow: h.peakWindow, topTypes: h.topTypes })),
    watchlist: repeatOffenders(vs, now).map((o) => ({ key: o.key, plate: o.plate, count: o.count, last: o.last, types: o.types, escalation: o.escalation })),
  };
}
