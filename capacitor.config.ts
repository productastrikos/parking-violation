import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Park Patrol — the installable Android app (APK) for the no-network campus.
 *
 * The WebView loads the guard app from files INSIDE the app (`dist-native/`,
 * built with `vite build --mode native`), so it opens with no network at all.
 * That build is "cable only" (.env.native): it never calls a server, signs in
 * with the built-in demo accounts, and hands tickets to the laptop by USB
 * cable — each ticket saved as a picture in Pictures/ParkPatrol, which the
 * laptop reads over the cable (src/console/CableImport.tsx).
 *
 * Build: `npm run android:build` → android/app/build/outputs/apk/debug/app-debug.apk
 */
const config: CapacitorConfig = {
  appId: 'xyz.astrikos.parkpatrol',
  appName: 'Park Patrol',
  webDir: 'dist-native',
  android: {
    allowMixedContent: false,
  },
};

export default config;
