# Test number plates

Synthetic UAE-style plates (made up for testing — not real vehicles, not official designs) to try the
on-phone plate reader. Show them full-screen on a laptop or monitor and photograph them with the phone,
as the **plate close-up** in *Record a violation*.

| File | Plate | What the app reads (tested 11 Nov 2026) |
|---|---|---|
| `01-abudhabi-13-48217.jpg` | AD 13 · 48217 | ✅ 13 · 48217 |
| `02-abudhabi-5-12345-red.jpg` | AD 5 · 12345 (code in a red box) | ✅ 5 · 12345 |
| `03-dubai-A-27654.jpg` | Dubai A · 27654 | ✅ A · 27654 — pick **Dubai** in the emirate box |
| `04-dubai-BB-3091.jpg` | Dubai BB · 3091 | ⚠️ BB · 3001 — one digit off; the guard corrects it |
| `05-sharjah-2-55120.jpg` | Sharjah 2 · 55120 | ✅ 2 · 55120 — pick **Sharjah** |
| `06-abudhabi-7-90316-tilted.jpg` | AD 7 · 90316, tilted 8° | ⚠️ number right, code read as "B" |
| `07-dubai-K-6402-far.jpg` | Dubai K · 6402, small in frame | ❌ not read — "type it below" (shows why the close-up matters) |
| `08-abudhabi-50-1188-tilted-hard.jpg` | AD 50 · 1188, tilted 18° | ⚠️ 50 · 118 — a digit missing |

The emirate name is small on a plate and usually not picked up, so the emirate box stays on **Abu Dhabi**
unless the guard changes it. Every reading is shown for the guard to check before saving.

## Testing on an iPhone

1. Use the **deployed** URL (`https://parking.astrikos.xyz:8443/app`) in **Safari**. Offline mode and the
   plate reader's offline files only install over a trusted certificate.
2. Share → **Add to Home Screen** → open the **Park Patrol** icon → sign in as `guard1` while online.
   If you had it installed before this fix was deployed, tap **"A new version is ready — tap to update"**
   (or close and reopen the app twice).
3. Tap the camera button → **Vehicle** photo (anything) → **Plate close-up** → iOS opens the camera →
   photograph the plate on the laptop screen → **Use Photo**. The plate fields fill in about 1–3 s
   (the very first read after opening the app takes a few seconds longer while the reader loads).
4. **Offline check:** turn on Airplane mode, record another plate — it reads the same way, with no internet.

## Getting good reads

* **Fill the frame with the plate**, straight on. A plate that is small in the photo is not read (plate 07).
* Hold the phone parallel to the plate; a small tilt is fine, a steep angle drops digits (plate 08).
* Photographing a screen: lower the brightness a little and tilt the phone slightly to avoid glare and
  moiré stripes.
* Real cars: use your own or colleagues' cars (with their OK). Clean, well-lit plates read best; night,
  rain and dirty plates read worse — the guard can always type the plate.
