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

Nothing to set up on the server: printing happens on the phone. Direct Bluetooth printing needs the HTTPS
URL, which it already has. Guards configure the printer per phone under **Settings → Fine printer**
(see DEMO.md → Fine printer).

## 7. Reset demo data

```bash
pm2 stop parking_be_4357 && npm run reset && pm2 start parking_be_4357
```
Reseeds 46 sample violations (labelled "sample") and the demo accounts. Phones keep their own unsent
records and upload them on the next connection.
