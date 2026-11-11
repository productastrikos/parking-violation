import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';

/* Self-hosted typefaces (Astrikos theme §3): bundled, precached, so the guard
   app looks right with no network. */
import '@fontsource/lexend-deca/400.css';
import '@fontsource/lexend-deca/600.css';
import '@fontsource/lato/400.css';
import '@fontsource/lato/700.css';
import './styles/theme.css';
import { applyTheme } from './lib/ui';

/**
 * Two surfaces, one bundle:
 *   /app          → the guard app (installable, works offline)
 *   / and /team   → the control-room dashboard (online)
 * Each is its own chunk, so the phone does not download the dashboard's map.
 * The service worker serves the cached index.html for any path offline, and
 * this check picks the guard app from the path.
 */
const GuardApp = lazy(() => import('./guard/GuardApp'));
const ConsoleApp = lazy(() => import('./console/ConsoleApp'));

const isGuardApp = /^\/app(\/|$)/i.test(window.location.pathname);
applyTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>{isGuardApp ? <GuardApp /> : <ConsoleApp />}</Suspense>
  </StrictMode>,
);
