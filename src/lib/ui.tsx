/**
 * Small pieces both surfaces share: the violation-type icon, the plate chip,
 * the brand mark and the theme hook.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  Ban, Copy, Accessibility, Flame, Octagon, Footprints, Bus, Receipt, BoxSelect, Truck, ArrowLeftRight, Car, MoreHorizontal, type LucideIcon,
} from 'lucide-react';
import { emirateOf, type Plate } from './api';

const ICONS: Record<string, LucideIcon> = {
  ban: Ban,
  copy: Copy,
  accessibility: Accessibility,
  flame: Flame,
  octagon: Octagon,
  footprints: Footprints,
  bus: Bus,
  receipt: Receipt,
  'square-dashed': BoxSelect,
  truck: Truck,
  'arrow-left-right': ArrowLeftRight,
  car: Car,
  more: MoreHorizontal,
};

export function TypeIcon({ icon, size = 18 }: { icon?: string; size?: number }) {
  const I = (icon && ICONS[icon]) || Car;
  return <I size={size} strokeWidth={1.8} aria-hidden />;
}

export function PlateChip({ plate, large = false }: { plate?: Plate; large?: boolean }) {
  if (!plate || (!plate.number && !plate.code)) return <span className="chip">No plate</span>;
  const em = plate.emirate && plate.emirate !== 'OTH' ? plate.emirate : '';
  return (
    <span className={`plate${large ? ' plate-lg' : ''}`} title={emirateOf(plate.emirate)?.label}>
      {em && <span className="plate-em">{em}</span>}
      {plate.code && <span className="plate-code">{plate.code}</span>}
      <span>{plate.number || '?'}</span>
    </span>
  );
}

export function Brand({ sub }: { sub?: string }) {
  return (
    <div className="brand">
      <img src="/brand/astrikos-solo.png" alt="" />
      <div>
        <div className="brand-name">Park Patrol</div>
        {sub && <div className="brand-sub">{sub}</div>}
      </div>
    </div>
  );
}

/** Client logo, centred at the top of a sign-in card. */
export function ClientLogo() {
  return (
    <div className="client-logo">
      <img src="/brand/alphadata-logo.png" alt="Alpha Data" />
    </div>
  );
}

export function PoweredBy() {
  return (
    <div className="powered-by">
      <span>Powered by</span>
      <img src="/brand/astrikos-mark.png" alt="Astrikos" />
    </div>
  );
}

export const severityChip = (s: string) => (s === 'high' ? 'chip-danger' : s === 'medium' ? 'chip-warning' : 'chip-info');

/* ── theme (dark default, light optional; remembered per browser) ──────── */
type Theme = 'dark' | 'light';
const THEME_KEY = 'pp.theme';
let theme: Theme = (() => {
  try {
    return (localStorage.getItem(THEME_KEY) as Theme) || 'dark';
  } catch {
    return 'dark';
  }
})();
const themeListeners = new Set<() => void>();
export function applyTheme(t: Theme = theme) {
  theme = t;
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#121212' : '#F4F3F9');
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    /* private mode */
  }
  themeListeners.forEach((l) => l());
}
export function useTheme() {
  return useSyncExternalStore(
    (cb) => {
      themeListeners.add(cb);
      return () => themeListeners.delete(cb);
    },
    () => theme,
  );
}

/** Re-render every `ms` so "2 min ago" labels stay true. */
export function useNow(ms = 15_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
