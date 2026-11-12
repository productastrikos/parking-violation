# Park Patrol — demo guide

A security guard records parking and traffic violations on a phone **with no internet**. The phone reads
the number plate itself, warns about repeat offenders and stores everything locally. The moment it
reconnects, the records upload by themselves and appear live in the control room, where an AI advisory
says what to deal with first. Works on **Android and iPhone**.

| Surface | URL | Who |
|---|---|---|
| Guard app (installable, offline) | `https://parking.astrikos.xyz:8443/app` | security guards |
| Control room | `https://parking.astrikos.xyz:8443/` — sidebar: Dashboard · Violations · AI Advisory · Field Team | supervisor / admin |

## Accounts (password `Astrikos2026`)

| Username | Who | Use |
|---|---|---|
| `guard1` … `guard4` | Rashid Ahmed (Downtown), Imran Shaikh (Reem), Joseph Mathew (Khalidiyah), Bilal Hussain (Yas) | guard app |
| `supervisor` | Khalid Al Mansoori | control room (can add guards) |
| `admin` | Control Room Admin | control room |

The control room opens with ~180 **sample** violations from the last two weeks (labelled "sample"), shaped
like a city: busy hours per district, five repeat-offender plates, one duplicate pair. That is what the AI
advisory works from on first open.

**Demo GPS.** Phones default to a labelled **DEMO GPS** position inside the guard's own Abu Dhabi patrol
area, so a demo given from India still puts every pin in Abu Dhabi. A real GPS fix from outside the UAE
switches to demo automatically; *Settings → GPS source → Real GPS* uses the phone's receiver.

---

## Before the demo (once, ~3 minutes, phone ONLINE)

1. On the demo phone open `https://parking.astrikos.xyz:8443/app`.
2. **Install it:** Android (Chrome) ⋮ → **Install app** · iPhone (**Safari**) Share → **Add to Home Screen**.
3. **Open the app from the new icon** and sign in as `guard1` **while online** (iPhone: the Home Screen app
   has its own storage — sign in inside the installed app, not only in Safari).
4. **Settings → Offline mode: Ready.** If not, close and reopen the app once while online.
5. Record one test violation (allow **Camera**; also loads the plate reader for offline use). Have a
   plate to scan: a real car, or a picture from `test-plates/` on a laptop screen.
6. Control room on the projector: sign in as `supervisor`.

**Rehearse once on the same phone.**

## The demo (6–7 minutes)

1. **Control room** — the **AI Advisory** panel at the top: expected violations next 24 h, the top hotspot,
   repeat offenders, ranked actions. KPIs below, the live feed, the map (the guard's **RA** token is live).
2. **The guard's phone** — Home: connection, the **AI patrol outlook** for their district ("Fewer than 1 /
   About 2 violations expected in the next 3 h · peak 19:00"). **Patrol** tab: outlook, hotspots, and the
   **plate watchlist** — type `72814`: a repeat offender with 6 violations, "clamp or tow".
3. **Cut the connection: Airplane mode.** ⚠️ Wi-Fi off alone leaves mobile data on. The control room shows
   the phone **Offline** within seconds.
4. Swipe the app away, reopen from the icon — **it opens offline**. (Optional: sign out and back in — offline sign-in.)
5. **Record a violation**: camera button → **Vehicle** photo → **Scan plate** — point at the plate, it reads
   itself and locks (vibrates) → **Use plate** → tap the violation → area and GPS are filled → **Save**.
   Type the plate `5 72814` on a second one: the **repeat-offender warning** appears — offline.
   Header: **Offline · 2 saved**.
6. **Records** tab → open one → **Edit** (allowed until it uploads).
7. **Airplane mode off.** In seconds: *Uploading 1/2 … 2/2* and **"2 violations uploaded to the control room"**.
   Control room: rows appear **highlighted "just synced"**, *Offline · synced N min later*; the map flies
   there; the phone is **Online**; the advisory updates (the offender's count goes up).
8. **Put a mistake right.** On the phone: Records → an uploaded record → **Report a mistake** → "Wrong plate
   number" → Send. Control room: **Violations** shows *"1 record reported as a mistake"* → open it →
   **Correct it** (fix the plate, give a reason) or **Agree — void it**. The phone shows the decision at once
   (*Voided by the control room: …*). Every change keeps who, when, why and the before/after.
9. **AI Advisory** page: ranked actions with *why this ranks here*, the 24-hour forecast, hotspot map,
   repeat offenders (click one → its records), anomalies (the duplicate pair), and **deployment** — which
   guard to move where for the peak.
10. **Field Team**: guards, their phones, online/offline, live positions (DEMO-labelled), add a guard.

## What to say when asked

| They ask | Answer |
|---|---|
| Offline for hours? | Records stay on the phone (photos included) until a connection; app closed or phone restarted, nothing is lost. Sessions last 30 days. A half-filled form is kept as a draft. |
| Upload breaks halfway? | Each record has its own id; the server stores it once. A retry never duplicates. |
| Can a wrong record be corrected? | Yes. Before upload the guard edits or deletes it. After upload the guard **reports a mistake** (works offline) and the control room corrects it with a reason, or **voids** it — never deleted, always auditable, restorable. |
| How does the plate reading work? Internet? | On the phone, offline: it finds the plate in the frame, cleans it up and reads it several ways, then votes. The live scanner locks when frames agree. The guard always confirms. With a model configured, the server double-checks each uploaded plate photo too. |
| Where is the "AI"? | Forecast per area and hour, hotspots week on week, repeat-offender escalation (also on the phone, offline), duplicate and anomaly detection, guard deployment advice, and a ranked advisory that explains every item. Rules-based and explainable by default; a language model, if configured, words the brief and checks plates. It never changes a record — a supervisor decides. |
| Is the location real? | In this demo the phones use a labelled DEMO position in Abu Dhabi. In the field: one switch to real GPS. |
| Can the guard print the fine on the spot? | Yes, **Print penalty notice** on any record (it also opens by itself after Save). It's a standard municipal-style notice: authority, notice no., vehicle, offence code, place and time, fine in AED, pay-by date, officer, QR code, terms, signature line. Reprints say DUPLICATE COPY. It works offline. Set it up in **Settings → Fine printer**. |
| Does the control room see what was printed? | Yes. Every print is reported to the server, including prints made offline (they upload after the record). On the **Dashboard**, the **Notices issued today** tile shows the count, the AED total and the reprints. In **Violations** you can filter printed / not printed / printed more than once, and the record drawer shows the amount, the pay-by date and **every print**: original, duplicates and office copies, with who printed it, when, on which phone and on which printer. **View notice** re-draws exactly what the driver got. **Office copy** prints it from the dashboard and logs that print too. The first print moves the record to **Fine issued**. **Field Team** shows notices per guard. The CSV export includes them. |
| Who can change the fines? | An **admin on the dashboard** (Violations → **Fine schedule**) and a **supervisor in the app** (sign in as `supervisor`, then **Settings → Fine schedule**). A reason is required, and every change is logged with name, role and time. Phones get the new amounts at once, or on their next connection if offline. A notice already printed keeps its amount. Guards can see the schedule but cannot change it. |
| Printer on iPhone? | iPhone Safari gives web apps no Bluetooth (Apple's rule). Options: **Printer app via Share** sends the notice image to the printer maker's iOS app; **AirPrint** works for AirPrint printers; or open the app in the free **Bluefy** browser for direct Bluetooth. Android Chrome pairs the printer directly. |
| iPhone? | Same app from the same link via Safari → Add to Home Screen. Uploads happen while the app is open (iPhone has no background sync; Android behaves the same here). |

## Honest limits (POC)

* JSON file store and local photo folder — Postgres + object storage is the production shape.
* Plate reading: test plates read **7 of 8 numbers** on the photo path and lock in under 2 s on the live
  scanner; strongly tilted, dirty or night plates read worse. The emirate name is small and usually not
  read — the guard picks it. Dubai letter codes are kept as read.
* Uploads run while the app is open or brought to the foreground (both platforms).
* Forecasts come from ~2 weeks of synthetic sample data; on real data they need a few weeks to settle.
* The AI check of plates and the AI-written brief need `LLM_PROVIDER` / `LLM_API_KEY` on the server;
  without them the advisory is fully rules-based (and says so).

## Fine printer (Settings → Fine printer)

| Phone | Printer | Choose |
|---|---|---|
| Android (Chrome) | BLE ESC/POS thermal printer (most 58/80 mm mini printers) | **Bluetooth printer (direct)** → Pair → Test print |
| Android | Classic-Bluetooth / USB / Wi-Fi printer | **RawBT print service** (free Play Store app; select the printer in RawBT once) |
| iPhone | Any printer with an iOS app | **Printer app via Share** → pick the maker's app |
| iPhone | AirPrint printer | **AirPrint** |
| iPhone | BLE ESC/POS printer, direct | Open the app in the **Bluefy** browser → Bluetooth printer (direct) |

Paper 58 mm (384 dots) or 80 mm (576 dots). The notice prints as one image (ESC/POS raster), so it looks the
same on every brand. You can edit the header (issuing authority, section), days to pay and the payment/appeal
terms. **The starting fine amounts are sample values.** Change them under **Fine schedule** (admin on the dashboard,
supervisor in the app). Offence codes come from `shared/catalog.js`.

## Run it on a laptop

```bash
npm install
npm run dev                 # API :4357 + HTTPS web :3357 (self-signed)
npm run phone               # LAN URL as a QR code for a phone on the same Wi-Fi
npm run start:lan           # production build on http://localhost:3357 — test offline mode on this laptop
npm run reset               # wipe server data (next start reseeds)
```
Phones on the LAN can use the online flows, but **neither Chrome nor Safari installs offline mode over the
self-signed dev certificate — the phone offline demo must use the deployed https URL.**
