# Park Patrol — deployment (astrikos.xyz)

Follows `deployment_context.md`: two ports, two nginx blocks, REST + WebSocket on one backend port.

| | Port | Subdomain | pm2 name | Cloudflare |
|---|---|---|---|---|
| Frontend (dashboard `/` + guard app `/app`) | **3357** | `parking.astrikos.xyz` | `parking_3357` | Orange |
| Backend (REST + Socket.IO) | **4357** | `parking-api.astrikos.xyz` | `parking_be_4357` | **Gray** (DNS only) |

Add to the port registry: `| parking | 3357 | 4357 | live |`

## 1. Build and run

```bash
cd parking-violence
npm install && npm run build              # also copies the plate-reader files into public/ocr (needs internet once)
                   # and, the first time, downloads the offline street map into public/map (~20 MB, 2–3 min)
                   # uses .env.production → dist/ (includes sw.js = offline mode)

# Frontend — static. serve reads dist/serve.json (no-cache on sw.js / index.html).
pm2 start serve --name parking_3357 -- ./dist -s -p 3357

# Backend — REST + Socket.IO on one port. Data in server/data/ (store.json + uploads/).
PORT=4357 APP_PASSWORD=Astrikos2026 ALLOWED_ORIGINS=https://parking.astrikos.xyz:8443 \
  pm2 start server/index.js --name parking_be_4357
# Optional AI (plate double-check + written brief): add LLM_PROVIDER=groq LLM_API_KEY=… (see .env.example).
# Without it the AI Advisory runs rules-based — everything still works.

pm2 save
```

`.env.production` (already in the repo):
```
VITE_API_URL=https://parking-api.astrikos.xyz:8443
VITE_SOCKET_URL=https://parking-api.astrikos.xyz:8443
```

## 2. nginx

`astrikos.conf` — frontend:
```nginx
server {
    listen 8443 ssl;
    ssl_certificate     /etc/certs/astrikos.xyz/fullchain.pem;
    ssl_certificate_key /etc/certs/astrikos.xyz/privkey.pem;
    server_name parking.astrikos.xyz;
    location / {
        add_header 'Access-Control-Allow-Origin' '*' always;
        proxy_pass http://127.0.0.1:3357;
    }
}
```

`astriverse.conf` — backend (the `map $http_upgrade $connection_upgrade` is already at the top of the file):
```nginx
server {
    listen 8443 ssl;
    ssl_certificate     /etc/certs/astrikos.xyz/fullchain.pem;
    ssl_certificate_key /etc/certs/astrikos.xyz/privkey.pem;
    server_name parking-api.astrikos.xyz;

    # REQUIRED: each violation uploads with up to two photos (~0.3–1.5 MB).
    # nginx's default limit is 1 MB and would reject them with 413.
    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:4357;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 7d;
        proxy_send_timeout 7d;
        proxy_read_timeout 7d;
        proxy_buffering off;
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 3. Verify

```bash
curl -k https://parking.astrikos.xyz:8443/app                      # SPA HTML
curl -k -I https://parking.astrikos.xyz:8443/sw.js                 # Cache-Control: no-cache
curl -k https://parking-api.astrikos.xyz:8443/api/health           # {"ok":true,...}
curl -k https://parking.astrikos.xyz:8443/version.json             # {"build":"<time of this build>"}
curl -k https://parking.astrikos.xyz:8443/map/meta.json            # {"tiles":1936,...} — the offline street map
```

Then on a phone: open `https://parking.astrikos.xyz:8443/app`, sign in as `guard1`, and check **Settings → Offline mode: Ready**.

## 4. Why HTTPS on the real domain matters

The guard app's offline mode is a service worker; camera, GPS and offline sign-in need a secure context.
Android Chrome tolerates a self-signed LAN certificate for most of this, **iPhone Safari does not install the
service worker over a self-signed certificate** — so the offline demo on an iPhone must use this deployed URL.

## 5. Updating

```bash
git pull && npm install && npm run build && pm2 restart parking_3357    # + pm2 restart parking_be_4357 if server/ changed
curl -k https://parking.astrikos.xyz:8443/version.json                   # shows the new build time
```

### This update (18 Nov 2026): cable handover, offline map, patrol routes

Same command, **and restart the backend**: `server/` changed.

```bash
cd parking-violence
git pull && npm install && npm run build      # first build fetches the street map (needs internet once; see below)
pm2 restart parking_3357 && pm2 restart parking_be_4357
curl -k https://parking.astrikos.xyz:8443/map/meta.json                  # the map is served
curl -k https://parking-api.astrikos.xyz:8443/api/health                 # backend is up
```

- **No data migration to run.** On first start the backend adds two sample patrol routes (guard1, guard2) to the
  existing `server/data/store.json`; tickets, fines, users and the print log are kept. Tested against data written by
  the previous version.
- **Offline street map.** `public/map` is not in git. `npm run build` downloads it once (`prebuild` →
  `scripts/fetch-map.mjs --if-missing`, OpenStreetMap data from build.protomaps.com) and reuses it on every later
  build. If the server cannot reach the internet the build still succeeds and the maps fall back to online tiles; run
  `npm run map:fetch` later to add the map. Refreshing the map: `npm run map:fetch && npm run build`.
- **Phones download more once.** The guard app now keeps the street map offline: on its next update each phone
  downloads roughly 20–30 MB (the map plus the changed app files) in the background — the offline copy is 32 MB in
  all. Update the demo phones on Wi-Fi and open the app once.
- **No new environment variables, ports or nginx changes.** The new endpoints (`/api/routes`, `/api/patrols`,
  `/api/cable/import`, `/api/cable/patrol`) are on the same backend.
- **Check:** dashboard → **Field Team** shows **Patrol routes** with a street map; guard app → **Patrol** shows the
  guard's route.

The laptop-only demo (no server, cable handover) and the Android app are built on a PC, not on this server:
`npm run android:build` and `npm run package` → `release/ParkPatrol-Demo.zip`. See `DEMO-CABLE.md`.

Every build is stamped with its build time (`/version.json`, served no-cache). That time is shown in the
dashboard sidebar ("Powered by Astrikos · build …"), in the guard app under **Settings → Version**, and per
phone on the **Field Team** page — so "is it on the new version?" has a visible answer.

How the new version reaches people — no hard refresh needed:

| Where | What happens |
|---|---|
| **Dashboard** (`/`, `/violations`, …) | Always loads fresh from the server (the offline cache only serves `/app`). An open tab notices the new build within ~3 min or on focus: a hidden tab reloads itself, a visible one shows **"A new version … Reload now"**. |
| **Guard app** (`/app`) | Checks on open, on coming to the foreground, every 10 min and via `/version.json`. The new version installs in the background and **applies by itself** (≈1 s reload) whenever no violation form is open. A form in progress is never reloaded — it updates when the guard leaves the form. Unsent records are not affected. |

**One-time, only for browsers that opened the site before this fix (12 Nov 2026):** their old offline cache
still holds the old dashboard. Do **Ctrl+Shift+R** (Mac: Cmd+Shift+R) once on the dashboard — or close every
tab of the site and reopen. From then on updates arrive automatically. Phones: open the app, tap
**"A new version is ready"** if shown (or close and reopen the app twice).

## 6. Fine printer

Printing happens on the phone, so there is nothing to install on the server. Direct Bluetooth printing needs the
HTTPS URL, which the app already uses. Guards set up the printer on each phone under **Settings → Fine printer**
(see DEMO.md → Fine printer).

The server keeps the **print log** (`notices` on each violation; `POST /api/violations/:id/notice`) and the
**fine schedule** (`GET/PUT /api/fines`, editable by supervisor and admin, with every change logged). Both are
stored in `server/data/store.json`. The schedule starts from the sample amounts in `shared/catalog.js`.
**Restart the backend after updating** so it serves these endpoints.

## 7. Reset demo data

```bash
pm2 stop parking_be_4357 && npm run reset && pm2 start parking_be_4357
```
Reseeds 46 sample violations (labelled "sample") and the demo accounts. Phones keep their own unsent
records and upload them on the next connection.
