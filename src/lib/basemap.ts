/**
 * The base map under every map in the product — dashboard and guard app.
 *
 *   1. OFFLINE street map (preferred): vector tiles of Abu Dhabi shipped with
 *      the app in /map/{z}/{x}/{y}.mvt (scripts/fetch-map.mjs, OpenStreetMap
 *      data), drawn by protomaps-leaflet. Streets, names, buildings, water —
 *      no internet ever.
 *   2. Online OpenStreetMap tiles, when this build has no offline map.
 *   3. If those cannot load either: the patrol areas drawn as named circles.
 */
import L from 'leaflet';
import { leafletLayer } from 'protomaps-leaflet';
import { AREAS } from './api';

export interface OfflineMapMeta {
  maxZoom: number;
  tiles: number;
  attribution: string;
  center: [number, number];
}
export type BaseKind = 'offline' | 'online' | 'areas';

let metaP: Promise<OfflineMapMeta | null> | null = null;
export const offlineMapMeta = () =>
  (metaP ||= fetch('/map/meta.json', { cache: 'no-cache' })
    // A static server's SPA fallback answers a missing file with index.html — accept real meta only.
    .then((r) => (r.ok ? (r.json() as Promise<OfflineMapMeta>) : null))
    .then((m) => (m && typeof m.maxZoom === 'number' ? m : null))
    .catch(() => null));

/** Force the drawn areas base (rehearse "no map at all"): ?offline-map, or localStorage pp.offlineMap = 1. */
function areasForced() {
  try {
    return new URLSearchParams(window.location.search).has('offline-map') || localStorage.getItem('pp.offlineMap') === '1';
  } catch {
    return false;
  }
}

/** The last resort: every patrol area as a named circle, under the pins. */
function drawAreas(m: L.Map): L.Layer[] {
  if (!m.getPane('pp-areas')) m.createPane('pp-areas').style.zIndex = '350';
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--app-accent').trim() || '#3b82f6';
  const layers = AREAS.map((a) =>
    L.circle([a.lat, a.lng], { pane: 'pp-areas', radius: 1500, color: accent, weight: 1, dashArray: '4 5', fillColor: accent, fillOpacity: 0.07, interactive: false })
      .bindTooltip(a.label.replace(/ \(.*\)$/, ''), { permanent: true, direction: 'center', className: 'c-area-label', interactive: false })
      .addTo(m),
  );
  const names = () => m.getContainer().classList.toggle('is-far', m.getZoom() < 12);
  m.on('zoomend', names);
  names();
  m.getContainer().classList.add('is-offline-map');
  return layers;
}

/**
 * Put the base map on `m`. Returns what it used and how to take it off again
 * (for a theme change). Never throws.
 */
export async function mountBaseMap(m: L.Map, theme: 'dark' | 'light'): Promise<{ kind: BaseKind; remove: () => void }> {
  const meta = areasForced() ? null : await offlineMapMeta();
  if (meta) {
    const layer = leafletLayer({ url: '/map/{z}/{x}/{y}.mvt', flavor: theme === 'dark' ? 'dark' : 'light', lang: 'en', maxDataZoom: meta.maxZoom, attribution: meta.attribution }) as unknown as L.Layer;
    layer.addTo(m);
    return { kind: 'offline', remove: () => void m.removeLayer(layer) };
  }

  // No offline map in this build: online tiles, falling back to the drawn areas.
  const container = m.getContainer();
  let loaded = 0;
  let failed = 0;
  let areas: L.Layer[] = [];
  let kind: BaseKind = 'online';
  const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' });
  const toAreas = () => {
    if (kind === 'areas') return;
    kind = 'areas';
    m.removeLayer(tiles);
    areas = drawAreas(m);
    m.attributionControl?.addAttribution('Offline map · patrol areas');
  };
  if (areasForced() || navigator.onLine === false) toAreas();
  else {
    tiles.on('tileload', () => (loaded += 1));
    tiles.on('tileerror', () => {
      failed += 1;
      if (!loaded && failed >= 3) toAreas();
    });
    tiles.addTo(m);
    setTimeout(() => !loaded && toAreas(), 6000);
  }
  return {
    get kind() {
      return kind;
    },
    remove: () => {
      m.removeLayer(tiles);
      areas.forEach((a) => m.removeLayer(a));
      container.classList.remove('is-offline-map');
    },
  };
}
