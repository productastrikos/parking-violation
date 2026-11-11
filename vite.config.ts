import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * HTTPS by default: the guard app needs a SECURE CONTEXT for the camera, GPS,
 * WebCrypto (offline sign-in) and the service worker (offline mode). A phone on
 * `http://192.168…` gets none of them. `--mode http` opts out.
 *
 * The backend is proxied through this same origin (`/api`, `/uploads`,
 * `/socket.io`): an https page cannot call an http API (mixed content), and one
 * origin means one certificate to accept on the phone. Ports follow the
 * Astrikos pair for this POC: web 3357 ↔ API 4357 (deployment_context.md).
 *
 * OFFLINE NOTE: browsers (Chrome and Safari) will not register a service worker
 * for a page served with an untrusted (self-signed) certificate. Online flows can
 * be tested over the LAN; OFFLINE mode must be tested on the deployed https URL
 * (or on http://localhost on this machine: `npm run start:lan`).
 */
const BACKEND = `http://127.0.0.1:${process.env.BACKEND_PORT || 4357}`;
const proxy = {
  '/api': { target: BACKEND, changeOrigin: true },
  '/uploads': { target: BACKEND, changeOrigin: true },
  '/socket.io': { target: BACKEND, changeOrigin: true, ws: true },
};

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    ...(mode === 'http' ? [] : [basicSsl()]),
    /**
     * The offline layer. The service worker precaches the whole app shell —
     * JS, CSS, fonts, icons and the plate-reader files — so after ONE online
     * visit the guard app opens and works with no network at all.
     *
     * registerType 'prompt': a new version waits until the guard taps
     * "Update". An automatic reload could land in the middle of filling a
     * violation form.
     *
     * Navigations fall back to the cached index.html, which picks the guard
     * app or the dashboard by path. API, uploads and socket traffic are never
     * served from the cache — the sync engine must see real failures.
     */
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      manifest: {
        id: '/app',
        name: 'Astrikos Park Patrol',
        short_name: 'Park Patrol',
        description: 'Record parking and traffic violations — works offline, syncs when connected.',
        start_url: '/app',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#121212',
        theme_color: '#121212',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // woff2 only: every browser this app supports reads it; the .woff fallbacks would double the font download.
        globPatterns: ['**/*.{js,css,html,png,svg,woff2,ico,gz}'],
        // The plate reader's WASM core is ~4 MB per build; the default 2 MB cap would silently skip it.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/uploads\//, /^\/socket\.io\//],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { host: true, port: Number(process.env.PORT_WEB) || 3357, strictPort: true, proxy },
  preview: { host: true, port: Number(process.env.PORT_WEB) || 3357, strictPort: true, proxy },
  build: { chunkSizeWarningLimit: 1200 },
}));
