/**
 * The guard's patrol on the built-in offline map: the route, its numbered
 * checkpoints (green when reached, the next one highlighted), the "reached"
 * circles, and where the guard is now. No internet needed (src/lib/basemap.ts).
 */
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { LocateFixed } from 'lucide-react';
import { mountBaseMap } from '../../lib/basemap';
import { useTheme } from '../../lib/ui';
import type { PatrolRoute } from '../../lib/patrol';

export interface Position {
  lat: number;
  lng: number;
  accuracy?: number | null;
  demo?: boolean;
}

export default function PatrolMap({ route, reached, nextIdx, position, height = 300 }: { route: PatrolRoute; reached: Set<number>; nextIdx: number; position: Position | null; height?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const routeG = useRef<L.LayerGroup | null>(null);
  const meG = useRef<L.LayerGroup | null>(null);
  const fittedFor = useRef('');
  const theme = useTheme();

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { zoomControl: false, attributionControl: true, maxZoom: 18 }).setView([route.checkpoints[0].lat, route.checkpoints[0].lng], 15);
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    map.current = m;
    routeG.current = L.layerGroup().addTo(m);
    meG.current = L.layerGroup().addTo(m);
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    let alive = true;
    let base: { remove: () => void } | null = null;
    void mountBaseMap(m, theme).then((b) => (alive ? (base = b) : b.remove()));
    return () => {
      alive = false;
      base?.remove();
    };
  }, [theme]);

  // The route
  useEffect(() => {
    const g = routeG.current;
    const m = map.current;
    if (!g || !m) return;
    g.clearLayers();
    const pts = route.checkpoints.map((c) => [c.lat, c.lng] as L.LatLngTuple);
    L.polyline(route.loop && pts.length > 2 ? [...pts, pts[0]] : pts, { color: '#7c3aed', weight: 4, opacity: 0.8, dashArray: '8 8' }).addTo(g);
    route.checkpoints.forEach((c, i) => {
      const state = reached.has(i) ? 'is-done' : i === nextIdx ? 'is-next' : '';
      L.circle([c.lat, c.lng], { radius: route.radiusM, color: reached.has(i) ? '#16a34a' : '#7c3aed', weight: 1, fillOpacity: 0.08, interactive: false }).addTo(g);
      L.marker([c.lat, c.lng], { icon: L.divIcon({ className: '', html: `<div class="g-cp-pin ${state}"><span>${reached.has(i) ? '✓' : i + 1}</span></div>`, iconSize: [26, 26], iconAnchor: [13, 13] }) })
        .bindTooltip(`${i + 1}. ${c.label || 'Checkpoint'}`)
        .addTo(g);
    });
    if (fittedFor.current !== route.id) {
      fittedFor.current = route.id;
      m.fitBounds(L.latLngBounds(pts), { padding: [28, 28], maxZoom: 16 });
    }
  }, [route, reached, nextIdx]);

  // The guard
  useEffect(() => {
    const g = meG.current;
    if (!g) return;
    g.clearLayers();
    if (!position) return;
    if (position.accuracy) L.circle([position.lat, position.lng], { radius: position.accuracy, color: '#2563eb', weight: 0, fillOpacity: 0.12, interactive: false }).addTo(g);
    L.circleMarker([position.lat, position.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 })
      .bindTooltip(position.demo ? 'You (demo GPS)' : 'You')
      .addTo(g);
  }, [position]);

  return (
    <div className="g-patrol-map" style={{ height }}>
      <div ref={el} style={{ position: 'absolute', inset: 0 }} />
      {position && (
        <button className="g-map-me" onClick={() => map.current?.setView([position.lat, position.lng], Math.max(16, map.current.getZoom()))} aria-label="Centre on my position">
          <LocateFixed size={18} />
        </button>
      )}
    </div>
  );
}
