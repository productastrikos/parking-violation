# Demo — fine issued offline, handed to the laptop by USB cable

**What it shows:** a guard issues a fine on a phone with **no network**. The ticket stays on the phone. The phone is plugged into a laptop with a **USB cable**, and the ticket, photos and fine appear on the laptop's dashboard. The laptop is offline too. Works with **iPhone and Android**; no app store, no Wi-Fi, no internet during the demo.

**How it works (one line for the audience):** the phone saves each ticket as a picture that carries its data in a QR code. Over the cable the laptop reads the picture from the phone's Photos (iPhone) or Download folder (Android) and imports it.

> This is a demo of the workflow. The production design (native app, signed files, automatic transfer) is in `OFFLINE-ARCHITECTURE.md`. Say so if asked.

**Easiest: the install package.** `npm run android:build` then `npm run package` produce `release/ParkPatrol-Demo.zip`:

| In the zip | Install |
|---|---|
| `Laptop - Windows` / `Laptop - macOS` | Unzip, double-click **Start Park Patrol** — Node.js is inside, nothing else to install |
| `Android/ParkPatrol.apk` | Copy to the phone, tap it — the app needs no internet at all, not even to sign in (built-in demo accounts) |
| `iPhone/` | QR code to the web app — an iPhone cannot install apps from a zip (section 1b below) |
| `START HERE.html` | The install guide and demo script |

**Offline map and patrol routes.** A street map of Abu Dhabi is built into the laptop and the phone apps (`npm run map:fetch`, ~20 MB of OpenStreetMap data) — no internet needed. Supervisors draw each guard's route on Field Team → Patrol routes; the phone gets it by scanning **Code for phone** (Patrol → Scan route code); checkpoints tick off by GPS (or demo GPS: "walk the route"); the patrol report goes back to the laptop as a picture with the tickets.

The Android app saves ticket pictures to **Pictures › ParkPatrol** (the laptop reads them there). It prints the notice on a Bluetooth thermal printer paired in Android Settings (or via RawBT / the printer's own app / the print dialog), or issues the fine without paper. If the plate cannot be read, the guard takes the plate photo (**Photo only**) and can save without typing the number. The rest of this page is the same flow without the package.

---

## 1. One-time setup (do it with internet, the day before)

### a. Publish this build to the phones' site
The phones run the app from `https://parking.astrikos.xyz:8443/app` (the `:8443` is required). Deploy this version there first (see `DEPLOY.md`), or the phones will not have **Send to laptop by cable**.

### b. Each demo phone
1. Open `https://parking.astrikos.xyz:8443/app` in **Chrome** (iPhone and Android). On iPhone, scan the QR code from Chrome (press and hold the Chrome icon → Scan QR Code) — the Camera app opens Safari.
2. Install it: iPhone Chrome → Share (address bar) → **Add to Home Screen** (iOS 16.4+). Android Chrome → ⋮ → **Install app**.
3. Open the **installed** app and sign in once while online (e.g. `guard1` / `Astrikos2026`). This is what lets it sign in offline later.
4. If the app shows **A new version is ready — tap to update**, tap it (while online) so the phone has this build.
5. Optional: Settings → **GPS source** → **Demo** so pins land in Abu Dhabi.

### c. The laptop (the "Hub")
1. Node 20+ and this repository; run `npm install` once (needs internet once).
2. Start it: `npm run hub` → open **http://localhost:3357** → sign in `supervisor` / `Astrikos2026`.
3. **Windows + iPhone:** install the **Apple Devices** app from the Microsoft Store now (it brings the iPhone USB driver). Plug the iPhone in once, unlock it and tap **Allow / Trust**.
4. **Android:** plug the phone in once and check it appears under **This PC**.
5. Use a **data** USB cable (some cables only charge).

---

## 2. Rehearse (10 minutes)

Do the full script below once with Wi-Fi **off** on the laptop and the phone in **airplane mode**. To start the real demo with a clean laptop, stop the Hub and run `npm run reset` — it deletes the **laptop's** data and reloads the sample tickets (the phones are not touched).

---

## 3. Demo script (about 5 minutes)

| # | Do | Say / point at |
|---|---|---|
| 1 | Laptop Wi-Fi **off**. Phone **airplane mode on**. | "No network anywhere." The phone shows **Offline**. |
| 2 | Phone: **Record a violation** → photo, plate (auto-read), type → **Save**. | "Saved on the phone." |
| 3 | On the print screen: **Print notice** (if a printer is there) or **Issue without printing**. | "The fine is issued — AED amount, offence code, due date." |
| 4 | Phone Home → **Send to laptop by cable**. | Ticket pictures appear. |
| 5 | **iPhone:** **Save N pictures to Photos** → choose **Save N Images**. **Android:** **Save N pictures to this phone** (goes to Download). | "Each ticket is one picture with its data in the code." |
| 6 | Plug the **USB cable** into the laptop. **iPhone:** unlock → **Allow / Trust**. **Android:** pull down the notification → USB → **File transfer**. | "Only a cable." |
| 7 | Laptop dashboard → **Receive from phone** (Live feed, or Field Team) → **Choose pictures from the phone**. | |
| 8 | In the file window: **iPhone:** This PC › Apple iPhone › Internal Storage › DCIM › newest folder. **Android:** This PC › phone › Internal storage › Download. Select the new pictures (Ctrl+A is fine — other photos are skipped) → **Open**. | |
| 9 | Watch the list: **Imported · Fine AED …**. The live feed shows the ticket with **By cable**; the map gets a pin. | "From the phone to the control room, by cable." |
| 10 | Click **Open** on a row. | Photos, fine, offence code, the officer, and the history line **Received over USB cable**. |
| 11 | Optional: pick the same pictures again. | "Already on this laptop" — never duplicated. |
| 12 | **Patrol** (route loaded beforehand from **Code for phone**): phone → Patrol → **Start patrol** → **Demo: walk the route** (demo GPS, ~90 s) or walk it with real GPS → **Finish patrol**. | "The route came from the control room as a code — no network." Checkpoints tick off on the offline map. |
| 13 | Phone → **Send to laptop by cable** → laptop **Receive from phone**. | Field Team → Patrol routes: **4/4 checkpoints · by cable**. |

---

## 4. If something goes wrong

| Problem | Fix |
|---|---|
| iPhone share sheet has no **Save Images** | Close it, press and hold each picture in the sheet → **Save to Photos**. Then tap **I have saved them to Photos**. |
| iPhone not under **This PC** | Unlock it, tap **Allow/Trust**, unplug and replug. Make sure Apple Devices is installed. Try another cable. |
| DCIM is empty | Wait a few seconds and reopen the folder; keep the iPhone unlocked on the Home Screen. |
| The file window cannot open the phone | In File Explorer copy the pictures to the Desktop, then drag them onto the **Receive from phone** panel. |
| Android Chrome asks to allow multiple downloads | Tap **Allow** — one picture per ticket. |
| Android not under **This PC** | Notification shade → USB → **File transfer**. |
| "No ticket code found" | The picture was cropped, edited or is a screenshot. Save it again from the app. |
| "… is not on this laptop's team list" | The guard account does not exist on the laptop; the ticket is still imported under that name. Demo guards `guard1`–`guard4` exist on both. |
| Laptop is a **Mac** | Copy the pictures off with **Image Capture** (iPhone) or **Android File Transfer**, then drag them onto the panel. |
| The route code will not scan | **Take a photo of the code** instead; brighten the laptop screen. A code made for another guard is refused. |
| Checkpoints do not tick off | Real GPS: be within the route's radius (40 m default), outdoors. Demo GPS: Settings → GPS source → Demo, then **Demo: walk the route**. Or tap **I'm at …**. |
| Map shows circles, not streets | The built-in map is missing — run `npm run map:fetch` once with internet before building. Pins and routes still work on the drawn areas (forced with `?offline-map`). |

---

## 5. What was tested, and what was not

**Tested (18 Nov 2026, in a desktop browser against a throwaway server):**
- A ticket with an issued fine → ticket picture → decoded → imported with both photos, the fine, offence code, GPS, capture time and "Received over USB cable" in its history; the record moves to *Fine issued*.
- The picture still decodes after JPEG re-compression and at half size.
- Importing the same picture twice keeps one ticket and one fine. A later network upload of the same ticket is also recognised — no duplicates.
- An ordinary camera photo picked by mistake is skipped.
- The dashboard's **Receive from phone** panel (drag-and-drop path), the **By cable** chips, the device row and the offline map.
- The phone's **Send to laptop by cable** sheet (Android layout) and the laptop build (`npm run build:lan`).
- Built-in street map on the dashboard and the phone with no tile requests to the internet.
- Patrol routes: drawing and saving a route, **Code for phone**, loading it on the phone from a photo of the code, a demo-GPS patrol to 4/4, the patrol picture, and importing it (again = merged, not duplicated).

**Not tested — patrol:** scanning the route code with a live phone camera, real GPS on the campus, the Android app built with the map (check it in the rehearsal).

**Not tested yet — do this in the rehearsal:**
- A **real iPhone**: saving to Photos from the installed app, and reading those pictures from the laptop over the cable.
- A **real Android phone** over the cable (Download folder via File transfer).
- The Windows file window browsing the phone directly (the drag-from-Desktop fallback works either way).
