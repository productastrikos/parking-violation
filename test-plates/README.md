# Test number plates

Synthetic UAE-style plates (made up for testing — not real vehicles, not official designs) to try the
on-phone plate reader. Show them full-screen on a laptop or monitor and photograph them with the phone,
as the **plate close-up** in *Record a violation*.

| File | Plate | Photo reader (12 Nov 2026 build) |
|---|---|---|
| `01-abudhabi-13-48217.jpg` | AD 13 · 48217 | ✅ 13 · 48217 · Abu Dhabi — the **live scanner** locks after two frames agree |
| `02-abudhabi-5-12345-red.jpg` | AD 5 · 12345 (code in a red box) | ✅ 12345 · Abu Dhabi · code left for the guard |
| `03-dubai-A-27654.jpg` | Dubai A · 27654 | ✅ 27654 · Dubai · code left for the guard |
| `04-dubai-BB-3091.jpg` | Dubai BB · 3091 | ✅ 3091 · Dubai · code left for the guard |
| `05-sharjah-2-55120.jpg` | Sharjah 2 · 55120 | ✅ 55120 · Sharjah |
| `06-abudhabi-7-90316-tilted.jpg` | AD 7 · 90316, tilted 8° | ✅ 90316 |
| `07-dubai-K-6402-far.jpg` | Dubai K · 6402, small in frame | ✅ 6402 · Dubai (the reader finds the plate in the photo) |
| `08-abudhabi-50-1188-tilted-hard.jpg` | AD 50 · 1188, tilted 18° | ✅ 1188 (the reader straightens tilted plates) |

The emirate is set when its name is read on the plate (often for Dubai, Sharjah and Abu Dhabi); otherwise the
box stays on **Abu Dhabi**. Every reading is shown for the guard to check before saving.

## Real photos (12 Nov 2026 rewrite)

The first reader OCR'd the whole photo and took the longest run of digits — on real car photos it
"read" badges, signs and stickers (7 of 20 right). The reader now works like a licence-plate reader:

1. finds **rows of same-height characters on a light panel** (a plate number), at three zoom levels;
2. reads only those characters, redrawn clean, in **three views** (two clean masks + the original pixels);
3. fills the form **only when two views agree** and the character count matches; otherwise it shows
   **"Not sure — is it …? [Use it]"**, or "No plate number found" — it never fills in a guess.

Tested on 28 photos of real UAE cars and plates (Wikimedia Commons: close-ups, whole cars, police cars,
far-away plates) plus 8 photos with no plate (signs, speedometer, parking meters): **34/36 correct, 0 wrong
numbers filled in, 0 plates invented**. The two misses are a ~30 px plate (offered as a suggestion) and a
far-away pickup (nothing read). The code letter is filled only when it reads clearly; otherwise the guard
types it. A plate that is tiny in the photo, at night or badly angled may need a closer shot or typing.

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
