# Park Patrol — demo guide

A security guard records parking and traffic violations on a phone **with no internet**. Everything is saved
on the phone. The moment the phone reconnects, the records upload by themselves and appear live on the
control-room dashboard. Works on **Android and iPhone**.

| Surface | URL | Who |
|---|---|---|
| Guard app (installable, offline) | `https://parking.astrikos.xyz:8443/app` | security guards |
| Dashboard | `https://parking.astrikos.xyz:8443/` (Dashboard · Field Team) | supervisor / admin |

## Accounts (password `Astrikos2026`)

| Username | Who | Use |
|---|---|---|
| `guard1` … `guard4` | Rashid Ahmed, Imran Shaikh, Joseph Mathew, Bilal Hussain | guard app |
| `supervisor` | Khalid Al Mansoori | dashboard (can add guards) |
| `admin` | Control Room Admin | dashboard |

The dashboard opens with 46 **sample** violations from the past week (labelled "sample") so it is not empty.

---

## Before the demo (once, ~3 minutes, phone ONLINE)

1. On the demo phone open `https://parking.astrikos.xyz:8443/app`.
2. **Install it:**
   - **Android (Chrome):** ⋮ menu → **Install app** / **Add to Home screen**.
   - **iPhone (Safari — must be Safari):** Share button → **Add to Home Screen**.
3. **Open the app from the new icon** and sign in as `guard1` **while online**.
   *iPhone:* the Home Screen app has its own storage, separate from Safari — the sign-in must happen inside the installed app, not just in the Safari tab.
4. Check **Settings → Offline mode: Ready**. (If it says "Not ready", close and reopen the app once while online.)
5. Allow **Location** and **Camera** when asked (record one test violation — this also loads the plate reader).
6. On the laptop/projector open the dashboard and sign in as `admin`. The phone shows under **Devices** as Online.

**Rehearse steps 1–4 below once on the same phone.**

## The demo (4–5 minutes)

1. **Show the dashboard** — KPIs, the live feed, the map, the phone listed as **Online**.
2. **Cut the connection: turn on Airplane mode.**
   ⚠️ Turning off only Wi-Fi leaves **mobile data** on, and the phone stays online. Use Airplane mode (or turn off both).
   Within a few seconds the dashboard shows the phone as **Offline**.
3. **Prove it works offline:** swipe the app away completely and reopen it from the icon — it opens.
   Optional: *Settings → Sign out*, then sign in again — **offline sign-in** works (the banner says so).
4. **Record 2–3 violations** (≈30 s each): **Record a violation** →
   photo of the car → close-up of the number plate (the plate is **read on the phone**, offline — the guard checks it) →
   tap the violation (No parking, Double parked, Fire lane…) → area is pre-filled from GPS (GPS works offline), add a landmark → **Save**.
   The header shows **Offline · 3 saved**; the home screen shows **3 saved on phone, waiting to upload**.
5. **Turn Airplane mode off.** Within a few seconds the phone shows *Uploading 1/3 … 3/3* and
   **"3 violations uploaded to the control room"**.
   On the dashboard the records **appear by themselves**, highlighted **just synced**, with
   **Offline · synced N min later**; the map flies to the spot; the phone is **Online** again.
6. **Open one record**: vehicle photo (stamped with date, time, place and guard), plate close-up, GPS, the
   **timeline** (captured on the phone with no connection → stored N min → received by the server), and
   the actions **Mark reviewed / Issue fine / Dismiss**.
7. **Field Team** tab: each guard, their phone, online/offline, today's count, how many records were captured
   offline; **Add guard**, reset a password, deactivate.

## What to say when asked

| They ask | Answer |
|---|---|
| What if the guard is offline for hours? | Records stay on the phone (photos included) until a connection; nothing is lost if the app is closed or the phone restarts. Sessions last 30 days. |
| What if the upload breaks halfway? | Each record has its own id; the server stores it once. A retry can never create a duplicate. |
| Is the time the phone's time? | Yes, the capture time — and the server measures the phone's clock error at upload and corrects it if it is off by more than 2 minutes. |
| Does the plate reader need internet? | No. It runs on the phone. It works best on a close-up; the guard always confirms, and can type the plate. |
| No GPS in a basement car park? | The guard picks the area and types a landmark; GPS is added when available. |
| iPhone? | Same app from the same link, installed via Safari → Add to Home Screen. Uploads happen while the app is open (iPhone has no background sync; Android behaves the same way here for consistency). |
| Native app store app? | The same app can be wrapped as an Android/iOS app later (Capacitor) without a rewrite. |

## Honest limits (POC)

* The JSON file store and local photo folder are POC-grade; Postgres + object storage is the production shape.
* Plate reading: good on a straight close-up, weak on a whole-car photo. Codes in coloured boxes (e.g. the
  Abu Dhabi code) are often not read — the app then asks the guard to type the code instead of guessing.
* Uploads happen while the app is open or brought to the foreground (both platforms) — not while it is closed.
* The 46 records on first start are synthetic samples on approximate Abu Dhabi area locations.

## Run it on a laptop

```bash
npm install
npm run dev                 # API :4357 + HTTPS web :3357 (self-signed)
npm run phone               # prints the LAN URL as a QR code for a phone on the same Wi-Fi
```
Offline mode needs a production build with a trusted origin: `npm run start:lan` builds and serves it on
`http://localhost:3357` — test offline on **this laptop** (browser DevTools → Network → Offline).
Phones on the LAN can use the online flows, but **neither Chrome nor Safari installs offline mode over the
self-signed dev certificate — the phone offline demo must use the deployed https URL.**

`npm run reset` wipes the server data (next start reseeds).
