# Parking & Traffic Violation POC: Plan

**Status:** built and tested end-to-end (11 Nov 2026) · **Demo:** 12 Nov 2026 (morning), shared with Amit · run/demo: `DEMO.md` · deploy: `DEPLOY.md`

### Round 2 (11 Nov evening) — added on request
- **Demo GPS** (MBKS pattern): phones default to a labelled DEMO position inside the guard's Abu Dhabi patrol area; a real fix outside the UAE switches to demo automatically; Settings toggles Real GPS. Guards' live positions go to the control-room map.
- **Plate reading improved**: plate located in the photo, cropped, binarised and read several ways with voting (7/8 test plates' numbers vs 5/8 before); **live camera scanner** that locks when frames agree; optional server-side vision-model double-check.
- **AI use cases** (`shared/intel.js`, rules-based, explainable; a model only words the brief): forecast by area and hour, hotspots, repeat-offender escalation (+ offline watchlist warning on the phone), duplicates/anomalies, guard deployment, ranked advisory with reasons. Header AI Advisory button + popover, overview panel, full AI Advisory page; Patrol (AI) tab in the app.
- **Realistic app UI**: material layer (textured ground, lit cards, recessed inputs, pressable controls, native tab bar, bottom sheets, splash), dark + light.
- **Dashboard sidebar**: Dashboard · Violations · AI Advisory · Field Team.
- **View & edit records**: guard edits/deletes before upload, reports a mistake after upload (queued offline); control room edits with a mandatory reason (before/after kept), voids/restores (never deletes), resolves guard reports, bulk status, CSV of what is filtered; the guard's phone mirrors the decision.
- **Hardening**: crash-safe capture drafts, duplicate warning (same plate within 30 min), sign-in throttle, optional origin allow-list, security headers.

### Decisions taken after review (these override the sections below)
- **Ports / hosts:** frontend **3357**, backend **4357** → `parking.astrikos.xyz` / `parking-api.astrikos.xyz`.
- **Android and iPhone:** same PWA. iPhone installs via Safari → Add to Home Screen. **Background Sync is not used** on either platform, so both behave the same: uploads run while the app is open or returns to the foreground (on reconnect, every 8 s probe, Sync now).
- **Dashboard is two pages only:** *Dashboard* (KPIs that filter the feed, live feed, record drawer, map, devices, CSV) and *Field Team* (guards, devices, add guard / reset password / deactivate). The full Document Studio is deferred.
- **Violations are general city enforcement** (no-parking, double parking, PoD bay, fire lane, blocking, footpath, bus stop, unpaid, outside bay, loading zone, wrong way, abandoned, other). Location = GPS + Abu Dhabi area + landmark text.
- **English only**, Astrikos branding only.
- Plate reader runs on the phone (Tesseract.js, precached → works offline). When the code box is unreadable, the code is left blank for the guard instead of guessed.

---

## 1. What the call asked for

Example setting: a parking area at a building in Abu Dhabi (the "Schneider building" was the example; the exact location doesn't matter).

| # | Requirement (from the call) | Priority |
|---|---|---|
| 1 | A **mobile app** a security guard uses to record a parking/traffic violation: **photo**, **location**, **time**, **what the issue is** (manual entry). | Must |
| 2 | It must **work with no internet.** The guard can **sign in offline**, record violations, and everything is **stored on the phone**. | Must (the main point of the demo) |
| 3 | When the phone **reconnects**, every stored record **uploads to the server automatically** and **appears on the dashboard**. | Must |
| 4 | The live demo: the presenter **turns Wi-Fi off**, records violations, **turns it back on**, and the records show up on the dashboard. | Must |
| 5 | A **simple dashboard**: which **device/guard is signed in**, the **violations logged**, open one to see its details. | Must (the app matters more than the dashboard) |
| 6 | "Something that can be shared, like an HTML file." | Must: shared as a **link / QR code** (see D1) |
| 7 | **Read the number plate from the photo** so the guard doesn't type it, with manual entry as the fallback. | Nice to have |

The order of work follows the call: **offline + sync first**, the dashboard second, plate reading third.

---

## 2. The approach in one paragraph

The guard app is an **installable offline web app (PWA)**. It opens from a link, gets added to the home screen like an app, and after the first online visit it loads and runs with **no network at all**. Each violation is saved first to an **on-phone database (IndexedDB)**, photos included, in an **outbox**. A small **sync engine** watches for a real connection to the server. When it finds one, it uploads each queued record exactly once (each record carries its own ID, so a retry never creates a duplicate). The server stores the record and **pushes it to the dashboard over WebSocket** within about a second. The dashboard is a normal online web page on the same backend. It follows the same stack and conventions as the MBKS Tree project, so most of the plumbing is reused.

```
 GUARD PHONE (PWA, works offline)                      SERVER (Node, one port)              DASHBOARD (browser)
 ┌────────────────────────────────┐                   ┌──────────────────────────┐         ┌──────────────────────┐
 │ Capture: photos · plate · type │                   │ Express REST + Socket.IO │         │ KPIs · live feed     │
 │ location · time · notes        │                   │                          │         │ record drawer        │
 │        │                       │   POST /api/      │  idempotent insert       │ socket  │ devices online/off   │
 │        ▼                       │   violations      │  (by record id)          │ ──────► │ map                  │
 │ IndexedDB outbox  ──sync────────┼─────────────────►│  store.json + /uploads   │         │                      │
 │ (pending → synced)             │   (multipart:     │  io.emit(violation:new)  │         │                      │
 │ Service worker = app shell     │    data + photos) │                          │         │                      │
 │ Socket: device presence ───────┼──────────────────►│  device presence         │         │                      │
 └────────────────────────────────┘                   └──────────────────────────┘         └──────────────────────┘
```

---

## 3. Key decisions (and why)

### D1. PWA, not a single .html file, and no APK for tomorrow
- **A single HTML file can't do this reliably.** Opened from a file or a chat app, it can't register a service worker, and its storage is unreliable. On Android it often opens in a viewer instead of Chrome. That fails the "works offline and keeps the data" requirement.
- **A PWA is "the HTML that can be shared"**, done properly. We share it as a link or QR code. The guard taps *Add to Home screen*, it gets an icon, and it opens full-screen and offline.
- **APK later, not now.** This machine has no Java or Android SDK, so an APK tomorrow would mean installing Android Studio first. The MBKS project's Capacitor setup can wrap the same app as an APK later without a rewrite.

### D2. Offline sign-in
- The **first** sign-in on a device must be online. The app has to be loaded online once anyway to install.
- On a successful online sign-in, the app stores a **local password check**: a salted PBKDF2 hash made with the browser's built-in WebCrypto, never the password itself. It also stores the guard's profile and a long-lived server token.
- Later sign-ins **work offline** against that local check. Each record is stamped with the guard and the device.
- Server sessions are **saved to disk with a 30-day expiry**, so a server restart doesn't reject a guard's queued uploads. (MBKS kept tokens in memory; that gap gets fixed here.) If the server ever does reject the token, the records **stay queued** and the guard is asked to sign in online once.

### D3. Outbox + idempotent sync (the core of the POC)
- Every record gets a **client-generated UUID** when it's saved. The server **inserts each ID only once**: a repeat upload returns the existing record, so flaky networks and retries never create duplicates.
- **Photos travel in the same request as the record** (multipart), so a record never arrives without its evidence.
- Each record has a sync state shown to the guard: `Saved on phone` → `Uploading` → `Synced ✓` (or `Failed: reason`).
- **Sync triggers:** app start, the browser's `online` event, socket connect, returning to the app, a 15 s retry while anything is pending, a manual **Sync now** button, and Background Sync on Android Chrome (it can upload even when the app is closed, though Chrome decides the timing).
- **One upload at a time** (a Web Lock), oldest record first.

### D4. Detecting "online" correctly
`navigator.onLine` reports "online" whenever Wi-Fi is connected, even with no internet behind it (captive portals, dead routers). The app instead **checks `GET /api/health` with a 3-second timeout** and watches the socket. The badge only turns green when **our server** actually answers.

### D5. Upload over REST, live updates over WebSocket
Same rule as MBKS/JBVNL: **writes go over REST** (status codes, validation errors, safe retries for binary photos), and **the socket broadcasts the results**. The socket also carries **device presence**: which phone and guard are online, when each was last seen, and how many records it had pending when it reconnected.

### D6. Time: captured vs synced
Each record carries **`capturedAt`** (phone clock, when the guard saved it) and **`receivedAt`** (server clock, when it arrived). The dashboard shows a **"Captured offline"** badge, for example *Captured 10:43 · Synced 10:51 · 8 min offline*. That badge is the proof the demo is about. At sync time the server also measures **phone clock drift** and flags it if it's off by more than 2 minutes.

### D7. Location
- **Primary:** a **site → zone → bay** picker cached on the phone (for example *Schneider Building → Basement P1 → Bay 23*). Basements have no GPS signal, so the picker is what actually works.
- **Plus GPS** when available. GPS works without internet (it may take longer to get a first fix), and the dashboard map shows the point.
- The phone shows **no map**: map tiles need internet, and the dashboard shows the map instead.

### D8. Photos
- The app uses the phone's **own camera app** through the browser's photo picker (`<input capture>`). It works offline and needs no extra camera permission handling.
- Photos are **resized on the phone** (about 1600 px, JPEG, around 250 KB), so uploads are quick on a weak connection and storage holds hundreds of records.
- **Two photos per record:** the **vehicle in context** (evidence) and a **close-up of the number plate** (for reading the plate).
- Optional: a stamp burned onto the evidence photo (*date · time · site/zone · guard*).
- After a record syncs, only a thumbnail stays on the phone.

### D9. Number plate reading (time-boxed)
- **On the phone, offline:** **Tesseract.js** (OCR that runs in the browser). Its files are cached by the service worker, so it also works with no internet. It reads the **plate close-up**; the guard adjusts the crop box, and the result is limited to letters and digits and split into **code + number**. The guard **always confirms or edits**, picks the emirate (default Abu Dhabi), and can always type the plate by hand.
- **Honest expectation:** Tesseract does reasonably on a tight, straight-on plate close-up and poorly on a whole-car photo. That's why the guard takes a separate plate photo. If it isn't good enough in testing, the field stays manual, which doesn't block the demo.
- **Stretch (server, after sync):** re-read the plate with an AI vision model using MBKS's existing `vision()` code (needs an `LLM_API_KEY`). The dashboard would then show *"AI read AD 5 12845: differs from the guard's entry"* as an extra check.

### D10. Records are append-only
The guard can edit or delete a record **only while it's still on the phone**. Once synced, only the dashboard can change it (status: `New → Reviewed → Action taken / Dismissed`). Every change goes into the hash-chained audit log reused from MBKS `store.js`.

---

## 4. Data model

```ts
Violation {
  id: string                // client UUID = the duplicate-proof key
  ref: string               // human ref generated on the phone: PV-G01-261112-0007 (guard · date · sequence)
  type: ViolationTypeId     // from the catalogue below
  severity: 'low' | 'medium' | 'high'      // defaults from type, guard can change
  plate: { emirate: string; code: string; number: string; raw: string;
           source: 'ocr' | 'manual'; confidence?: number }
  vehicle?: { kind?: string; colour?: string; make?: string }
  location: { siteId: string; zoneId: string; bay?: string;
              gps?: { lat: number; lng: number; accuracy: number } }
  notes: string
  photos: { kind: 'vehicle' | 'plate'; url: string }[]   // url assigned by the server
  guardId: string; guardName: string
  deviceId: string; deviceLabel: string
  capturedAt: number        // epoch ms, phone clock
  capturedOffline: boolean
  receivedAt: number        // epoch ms, server clock
  clockSkewMs: number
  status: 'new' | 'reviewed' | 'actioned' | 'dismissed'
  history: { at: number; by: string; action: string; note?: string }[]
  ai?: { plate?: string; agrees?: boolean; model?: string }   // stretch
}

Device { deviceId; label ("Android 14 · Chrome", renameable e.g. "Gate 2 phone");
         guardId; online; lastSeen; lastSync; pendingAtReconnect; appVersion }
```

**Violation catalogue** (lives on the server; the phone caches a copy):
no-parking zone · fire lane / fire exit blocked · People of Determination bay without permit · reserved / allocated bay · double parking · blocking a vehicle, ramp or driveway · across two bays / outside lines · overstay (time limit) · EV bay, not charging · wrong direction / against flow · other (free text).

**Emirates:** Abu Dhabi (default), Dubai, Sharjah, Ajman, Umm Al Quwain, Ras Al Khaimah, Fujairah, Other / GCC.

**Seed data:** 2 guards, 1 supervisor, 1 admin (shared password `Astrikos2026`, the Astrikos convention). One site, *Schneider Building*, with zones Basement P1, Basement P2, Surface lot, Visitor parking, Drop-off and Loading bay; the site centre point is set in one file. About 40 sample violations over the past week, labelled as seeded, so the dashboard isn't empty. `npm run reset` wipes and reseeds.

---

## 5. API & socket contract

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/api/health` | anyone | connectivity check (D4) |
| POST | `/api/auth/login` | app / console | `{username, password}` → `{token, user}` |
| GET | `/api/reference` | signed in | sites, zones, violation types, emirates (cached on the phone) |
| POST | `/api/violations` | guard | multipart: `record` (JSON) + `vehicle` / `plate` photos. **201** = created, **200** = already had it |
| GET | `/api/violations` | console | list (filters: date, type, site, guard, status) |
| GET | `/api/violations/:id` | console | one record + history |
| POST | `/api/violations/:id/status` | console | review / action / dismiss |
| GET | `/api/devices` | console | device presence list |
| GET | `/api/stats` | console | KPI numbers |
| GET | `/api/export.csv` | console | CSV download |

**Socket.IO events:**
- phone → server: `device:hello {deviceId, label, guardId, pending, appVersion}` on every connect
- server → dashboards: `violation:created {violation, stats}` · `violation:updated` · `device:status {device}` · `devices:state [..]` on connect

---

## 6. Guard app (`/app`)

1. **Sign in.** Online the first time, offline after that. Shows *"Offline sign-in"* when it applies.
2. **Home.** A big **Record violation** button, a connection badge (🟢 Online · 🟠 Offline · 🔵 Syncing 2/5), the count **"3 saved on phone, will upload when online"**, a **Sync now** button, and today's records.
3. **Record a violation** (about 30 seconds, large touch targets):
   ① photo of the vehicle → ② photo of the plate → plate fills in (OCR) and the guard confirms → ③ violation type (icon grid) → ④ location (site/zone/bay, GPS attached automatically) → ⑤ notes (optional) → **Save**. It saves to the phone **instantly, online or not**.
4. **My records.** Each record with a thumbnail and its sync state; tap one to view (edit or delete only while unsynced).
5. **Settings.** Device name, server status, app version, sign out.

The app is English only for tomorrow; an Arabic toggle is optional later.

## 7. Dashboard (`/`)

- **KPI row:** violations today · captured offline (synced later) · awaiting review · devices online
- **Live feed / table:** ref, plate, type, zone, guard, captured, synced, **Captured offline** badge, status. New rows highlight as they arrive.
- **Record drawer:** both photos (zoom), plate, type, location + map pin, notes, **timeline** (captured on the phone, offline → received → reviewed), status buttons.
- **Devices panel:** each device, guard, 🟢 online / ⚪ offline, last seen, last sync, *pending when it reconnected*.
- **Map** (Leaflet + OpenStreetMap; online only): violation pins.
- **CSV export.**
- Astrikos theme tokens (v2, 26 Oct), dark + light, self-hosted fonts.

---

## 8. Repo layout & what's reused from MBKS

```
parking-violence/
  PLAN.md · DEMO.md · DEPLOY.md
  package.json · vite.config.ts (HTTPS dev + proxy + PWA plugin) · .env.example · .env.production · serve.json
  server/
    index.js           Express 5 + Socket.IO on one port
    lib/store.js       JSON store: atomic writes, migrate-on-load, hash-chained audit
    lib/seed.js        guards, sites/zones, a week of history
    lib/llm.js         (stretch) AI plate re-read
    data/              store.json + uploads/  (git-ignored)
  shared/catalog.js    violation types, emirates, severities; the server is the source of truth
  src/
    main.tsx           `/` → dashboard, `/app` → guard app
    lib/api.ts         URLs from env, types, request(), auth headers, socket
    guard/             GuardApp, Login, Home, CaptureFlow, Records, SyncBadge
    guard/offline/     db.ts (IndexedDB) · outbox.ts · sync.ts · connectivity.ts · offlineAuth.ts · photo.ts · plateOcr.ts
    console/           ConsoleApp, KpiRow, ViolationTable, ViolationDrawer, DevicesPanel, MapPanel
    styles/            Astrikos tokens
  public/              icons, manifest assets, OCR files (worker, wasm, eng language data)
  scripts/             preflight.mjs, phone.mjs
```

| Reused from `other_project` (MBKS) | As-is / adapted |
|---|---|
| `vite.config.ts`: HTTPS dev, same-origin proxy, `strictPort` | adapted (+ PWA plugin) |
| `scripts/preflight.mjs`, `scripts/phone.mjs` (LAN URL as a QR) | as-is |
| `server/index.js` skeleton: cors, compression, multer, auth helpers, socket bootstrap | trimmed |
| `server/lib/store.js`: atomic save, migrate-on-load, `audit()` hash chain | trimmed |
| `server/lib/llm.js`: `vision()` code for the stretch AI plate read | as-is |
| `src/lib/fieldOps.ts` patterns: env URLs, `request()`, session store | adapted into `api.ts` |
| Theme CSS + `@fontsource` fonts (offline-safe) | adapted to theme v2 |
| `capacitor.config.ts`, `src/lib/native.ts` | later, for an APK |

**New dependencies:** `vite-plugin-pwa` (service worker + manifest), `idb` (a small IndexedDB wrapper), `tesseract.js` (plate OCR). Everything else is already in the MBKS stack.

---

## 9. Build order (about 8–9 hours, offline-critical work first)

| # | Block | Time | Done when |
|---|---|---|---|
| 1 | Scaffold from MBKS: configs, scripts, theme, fonts | 0.5 h | `npm run dev` serves `/` and `/app` over HTTPS |
| 2 | **Server:** saved sessions, reference data, duplicate-proof `POST /api/violations`, list/detail/status, uploads, socket presence + broadcasts, seed | 1.5 h | posting the same record twice gives one record, and the socket event fires |
| 3 | **Guard app, online path:** sign in, capture (photos, type, location, manual plate), save | 1.5 h | a record from the phone appears on the dashboard |
| 4 | **Offline layer:** service worker + manifest (installs and opens offline), IndexedDB outbox, offline sign-in, connectivity check, sync engine, pending badges | 2 h | **the airplane-mode on/off script (§10) passes on a real phone** |
| 5 | **Dashboard:** KPIs, live table, drawer, devices panel, offline badge with times, map, CSV | 1.5 h | |
| 6 | **Plate OCR on the phone** (time-boxed; cut first if short on time) | 1–1.5 h | the plate close-up fills code + number and the guard edits it |
| 7 | Deploy to astrikos.xyz, rehearse on the demo phone over real HTTPS, DEMO.md + DEPLOY.md, share link + QR with Amit | 1 h | |

**Stretch, if time allows:** AI plate check after sync · evidence stamp on photos · Arabic · APK via Capacitor.

---

## 10. The demo (what Amit runs on the spot)

**Setup (once, the day before or the morning of):** on the demo phone, while online, open `https://<poc>.astrikos.xyz:8443/app` → sign in as `guard1` → **Add to Home screen** → open it once from the icon. Open the dashboard on the laptop/projector and sign in as `admin`.

1. Show the dashboard: the phone is listed as 🟢 online.
2. **Put the phone in airplane mode.** ⚠ *Turning off only Wi-Fi leaves mobile data on, and the phone stays online. Use airplane mode, or turn off both.* Within a few seconds the dashboard shows the phone ⚪ offline · last seen 10:41.
3. Close the app completely and reopen it from the home-screen icon. **It opens with no network.** Sign out and sign in again: **offline sign-in works.**
4. Record 2–3 violations (photo of a car → photo of its plate → plate fills in → type → zone/bay → Save). The badge reads **"3 saved on phone, will upload when online"**.
5. **Turn airplane mode off.** In about 2–5 seconds the phone shows *Syncing 1/3… 3/3 ✓*. The dashboard shows the phone 🟢 online, and the three records **appear live** with the **"Captured offline · 10:43 → synced 10:51"** badge.
6. Open one: photos, plate, type, location, map pin, and the timeline from captured to received.
7. *(Optional)* Reload the dashboard to show the records are saved on the server, not just shown live.

---

## 11. Risks & how they're handled

| Risk | Handling |
|---|---|
| Wi-Fi connected but no internet; the phone says "online" | the app checks `/api/health` instead of trusting `navigator.onLine` (D4) |
| Flaky link uploads the same record twice | client UUID; the server stores each ID once (D3) |
| A record arrives without its photos | photos go in the same request as the record (D3) |
| Server restart drops sessions, so queued uploads are rejected | sessions saved to disk, 30-day expiry; rejected records stay queued (D2) |
| Phone clock is wrong | drift measured at sync; both times shown (D6) |
| Browser clears the app's storage | `navigator.storage.persist()` + installed PWA |
| Stale app after a deploy (Cloudflare/browser caching `sw.js`) | `Cache-Control: no-cache` on `sw.js` and `index.html` via `serve.json`; versioned cache; "Update available" prompt |
| Service worker, camera and GPS need HTTPS | demo on the real `astrikos.xyz` HTTPS URL, not a LAN IP |
| **iPhone** | works offline, but has no Background Sync, so uploads happen while the app is open. **Prefer an Android phone with Chrome for the demo.** |
| OCR misreads a plate | the guard confirms every plate; manual entry is always there (D9) |
| No GPS in the basement | site/zone/bay picker is the main location; GPS is extra (D7) |
| Demo turns off Wi-Fi but mobile data is on | the demo script says airplane mode (§10) |

## 12. Not in this POC (said plainly)

Production-grade auth (hashing on the server, password policy, rate limiting) · Postgres (the JSON store is fine at demo scale; the schema can follow) · object storage for photos · APK / iOS store builds · push notifications · fines, payments, or police/RTA integration · multiple organisations · editing a record from the phone after it has synced.

---

## 13. Open questions (need answers before building)

1. **POC name + ports.** Proposed: `parking` → `parking.astrikos.xyz` / `parking-api.astrikos.xyz`, ports **3311 / 4311** (next free pair in `deployment_context.md`). The registry may be out of date, since MBKS used 3337/4337. Please confirm.
2. **Demo phone:** Android or iPhone?
3. **Branding:** Astrikos only, or a client logo too? "Schneider Building" is used only as a site name.
4. **Theme v2's KPI drawer + Document Studio:** OK to ship a light KPI drawer + CSV export for this POC and leave the full Document Studio for later?
5. **Violation types:** keep the list in §4 or edit it?
6. **Language:** English only for tomorrow, or an Arabic toggle?
