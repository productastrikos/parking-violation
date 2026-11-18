/**
 * `npm run map:fetch` — download the OFFLINE STREET MAP of Abu Dhabi once.
 *
 * Source: the Protomaps daily world basemap (OpenStreetMap data, ODbL), read
 * by HTTP range requests — only the tiles we need are fetched, never the
 * whole ~130 GB archive. Tiles land in public/map/{z}/{x}/{y}.mvt (vector,
 * uncompressed) with public/map/meta.json; the laptop serves them, the Android
 * app and the web app carry them, and protomaps-leaflet draws them — streets,
 * names, buildings, water — with no internet.
 *
 * Coverage (more detail where the guards work):
 *   zoom 0–9    the UAE (context)
 *   zoom 10–12  Abu Dhabi emirate core
 *   zoom 13–15  Abu Dhabi city: Mussafah · MBZ · Khalifa City · Yas · Saadiyat · downtown
 *
 * Needs internet once, on the build machine. Re-run to refresh the map (the
 * old map stays in place until the new one is complete).
 * Licence: © OpenStreetMap contributors (ODbL) — the map shows the credit.
 *
 * `--if-missing` (runs before every `npm run build`, e.g. on the server after
 * `git pull`): does nothing when the map is already there, and never fails the
 * build — with no internet it warns and the maps fall back to online tiles /
 * drawn areas.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'public', 'map');
const part = path.join(root, 'node_modules', '.cache', 'map-part');
const IF_MISSING = process.argv.includes('--if-missing');

const REGIONS = [
  { name: 'UAE', zooms: [0, 9], bbox: [51.4, 22.5, 56.5, 26.2] },
  { name: 'Abu Dhabi emirate core', zooms: [10, 12], bbox: [53.9, 23.95, 55.0, 24.75] },
  { name: 'Abu Dhabi city', zooms: [13, 15], bbox: [54.26, 24.3, 54.68, 24.6] },
];

const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

async function latestBuild() {
  if (process.env.MAP_BUILD) return process.env.MAP_BUILD;
  for (let d = 0; d < 10; d++) {
    const day = new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10).replace(/-/g, '');
    const url = `https://build.protomaps.com/${day}.pmtiles`;
    const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (r?.ok) return url;
  }
  throw new Error('No recent Protomaps build found — set MAP_BUILD to a .pmtiles URL');
}

async function main() {
  const { PMTiles, FetchSource } = await import('pmtiles');
  const url = await latestBuild();
  console.log(`Map source: ${url}`);
  const pm = new PMTiles(new FetchSource(url));
  const header = await pm.getHeader();
  console.log(`Archive: zoom ${header.minZoom}–${header.maxZoom}, tile type ${header.tileType}`);

  const jobs = [];
  for (const r of REGIONS) {
    const [w, s, e, n] = r.bbox;
    for (let z = r.zooms[0]; z <= Math.min(r.zooms[1], header.maxZoom); z++) {
      for (let x = lon2x(w, z); x <= lon2x(e, z); x++) for (let y = lat2y(n, z); y <= lat2y(s, z); y++) jobs.push([z, x, y]);
    }
  }
  const total = jobs.length;
  console.log(`${total} tiles to fetch…`);

  fs.rmSync(part, { recursive: true, force: true });
  let done = 0;
  let bytes = 0;
  let empty = 0;
  async function worker() {
    for (;;) {
      const job = jobs.shift();
      if (!job) return;
      const [z, x, y] = job;
      let res;
      for (let attempt = 1; ; attempt++) {
        try {
          res = await pm.getZxy(z, x, y);
          break;
        } catch (e) {
          if (attempt >= 4) throw new Error(`tile ${z}/${x}/${y}: ${e.message}`);
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
      if (res?.data?.byteLength) {
        const file = path.join(part, String(z), String(x), `${y}.mvt`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, Buffer.from(res.data));
        bytes += res.data.byteLength;
      } else empty += 1;
      done += 1;
      if (done % 200 === 0) console.log(`  ${done} tiles, ${(bytes / 1048576).toFixed(1)} MB`);
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));

  const meta = {
    source: url,
    fetchedAt: new Date().toISOString(),
    regions: REGIONS,
    minZoom: 0,
    maxZoom: Math.min(15, header.maxZoom),
    center: [24.4539, 54.3773],
    tiles: total - empty,
    bytes,
    attribution: '© OpenStreetMap contributors · Protomaps',
  };
  fs.writeFileSync(path.join(part, 'meta.json'), JSON.stringify(meta, null, 2));
  // Swap in the complete map only now — a failed refresh leaves the old map intact.
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.cpSync(part, out, { recursive: true });
  fs.rmSync(part, { recursive: true, force: true });
  console.log(`\nOffline map ready: ${meta.tiles} tiles, ${(bytes / 1048576).toFixed(1)} MB → public/map\n`);
}

if (IF_MISSING) {
  let present = null;
  try {
    present = JSON.parse(fs.readFileSync(path.join(out, 'meta.json'), 'utf8'));
  } catch {}
  if (present) {
    console.log(`Offline map present: ${present.tiles} tiles, fetched ${String(present.fetchedAt).slice(0, 10)} (npm run map:fetch to refresh)`);
  } else {
    console.log('No offline map yet — fetching it once (~20 MB of OpenStreetMap tiles, a minute or two)…');
    await main().catch((e) => {
      fs.rmSync(part, { recursive: true, force: true });
      console.warn(`\n  ! Offline map not fetched (${e.message}).`);
      console.warn('    The build continues: maps use online tiles, or drawn areas with no internet. Retry: npm run map:fetch\n');
    });
  }
} else {
  await main().catch((e) => {
    fs.rmSync(part, { recursive: true, force: true });
    console.error(`\nOffline map not fetched: ${e.message}\n`);
    process.exit(1);
  });
}
