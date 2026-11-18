/**
 * Android app only: the pocket printer through the native FinePrinter plugin
 * (android/app/src/main/java/xyz/astrikos/parkpatrol/FinePrinterPlugin.java).
 * The app's WebView has no Web Bluetooth, share sheet or print dialog, so the
 * same four routes as the web app run natively here.
 */
import { registerPlugin } from '@capacitor/core';

export interface PairedPrinter {
  name: string;
  address: string;
  /** Imaging or unclassified device — what thermal printers report. */
  printerLike?: boolean;
}

interface FinePrinterPlugin {
  listPrinters(): Promise<{ printers: PairedPrinter[] }>;
  printEscPos(o: { address: string; data: string }): Promise<void>;
  rawbt(o: { data: string }): Promise<void>;
  shareImage(o: { name: string; data: string }): Promise<void>;
  systemPrint(o: { name: string; data: string }): Promise<void>;
}

export const FinePrinter = registerPlugin<FinePrinterPlugin>('FinePrinter');

/** Capacitor puts the native message in `message`; keep only the human part. */
export function nativeMessage(e: unknown) {
  const m = (e as { message?: string })?.message || String(e);
  return m.replace(/^Error:\s*/, '');
}
