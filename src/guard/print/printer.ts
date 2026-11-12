/**
 * The guard's pocket fine printer. Four ways to reach one, because phones and
 * printers differ:
 *
 *   bluetooth  Direct Bluetooth (BLE) to an ESC/POS thermal printer, from the
 *              app itself. Android Chrome, desktop Chrome/Edge. NOT iPhone
 *              Safari — Apple does not give web apps Bluetooth (an iPhone can
 *              use it inside the free "Bluefy" browser, which adds it).
 *   rawbt      Android: hands the print job to the RawBT print-service app,
 *              which talks to classic-Bluetooth (SPP), USB and Wi-Fi printers
 *              the browser cannot reach.
 *   share      iPhone + Android: the notice as an image to the share sheet →
 *              the printer maker's own app (most mini printers ship one), or
 *              AirPrint / Save to Files.
 *   system     The phone's print dialog: AirPrint on iPhone, the Android print
 *              service (Mopria / maker plug-in) on Android.
 *
 * Every method prints the SAME picture (notice.ts), so the notice looks the
 * same whichever way it reaches paper. Settings are per phone (localStorage).
 */
import { useSyncExternalStore } from 'react';
import { isIOS } from '../offline/device';
import { canvasToEscPos } from './escpos';
import { DEFAULT_LAYOUT, printImage, type NoticeLayout } from '../../lib/notice';

export type PrintMethod = 'bluetooth' | 'rawbt' | 'share' | 'system';
export type Paper = 58 | 80;

/** Notice layout (paper, authority header, terms, days to pay) + how this phone reaches its printer. */
export interface PrinterSettings extends NoticeLayout {
  method: PrintMethod;
  /** After saving a new violation, open the print screen. */
  offerAfterSave: boolean;
  btName?: string;
  btId?: string;
}

const KEY = 'pp.printer';
export const hasWebBluetooth = () => typeof navigator !== 'undefined' && 'bluetooth' in navigator;
const isAndroid = () => /Android/i.test(navigator.userAgent);
export const canShareFiles = () => {
  try {
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File([new Uint8Array(1)], 'x.png', { type: 'image/png' })] });
  } catch {
    return false;
  }
};

function defaults(): PrinterSettings {
  return {
    method: hasWebBluetooth() ? 'bluetooth' : isIOS() ? 'share' : 'system',
    ...DEFAULT_LAYOUT,
    offerAfterSave: true,
  };
}

let settings: PrinterSettings = (() => {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaults(), ...(JSON.parse(raw) as Partial<PrinterSettings>) };
  } catch {
    /* private mode / bad JSON */
  }
  return defaults();
})();
const listeners = new Set<() => void>();

export const getPrinter = () => settings;
export function setPrinter(p: Partial<PrinterSettings>) {
  settings = { ...settings, ...p };
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}
export const layoutOf = (p: PrinterSettings): NoticeLayout => ({ paper: p.paper, authority: p.authority, department: p.department, footer: p.footer, payDays: p.payDays });
export function resetPrinterText() {
  const d = defaults();
  setPrinter({ authority: d.authority, department: d.department, footer: d.footer, payDays: d.payDays });
}
export const usePrinter = () =>
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => settings,
  );

/** What each method is called, and whether this phone can use it. */
export function methodInfo(m: PrintMethod): { label: string; sub: string; available: boolean; why?: string } {
  switch (m) {
    case 'bluetooth':
      return {
        label: 'Bluetooth printer (direct)',
        sub: 'Pair once; prints straight from the app. ESC/POS thermal printers.',
        available: hasWebBluetooth(),
        why: isIOS() ? 'iPhone Safari does not allow Bluetooth for web apps. Use “Printer app” or “AirPrint” below, or open Park Patrol in the Bluefy browser.' : 'This browser has no Bluetooth access. Use Chrome on Android.',
      };
    case 'rawbt':
      return {
        label: 'RawBT print service (Android)',
        sub: 'For classic-Bluetooth, USB or Wi-Fi printers. Needs the free RawBT app.',
        available: !isIOS(),
        why: 'Android only.',
      };
    case 'share':
      return {
        label: isIOS() ? 'Printer app / AirPrint via Share' : 'Printer app via Share',
        sub: "Sends the notice image to the printer maker's app (or AirPrint, Files).",
        available: true, // without a share sheet it saves the image instead
      };
    case 'system':
      return {
        label: isIOS() ? 'AirPrint (system print)' : 'System print',
        sub: isIOS() ? 'The iPhone print dialog — AirPrint printers.' : 'Android print service — Mopria or the maker’s plug-in.',
        available: true,
      };
  }
}
export const METHODS: PrintMethod[] = ['bluetooth', 'rawbt', 'share', 'system'];
export const recommendedMethod = (): PrintMethod => (hasWebBluetooth() ? 'bluetooth' : isIOS() ? 'share' : isAndroid() ? 'rawbt' : 'system');

/* ══ Bluetooth (Web Bluetooth, GATT) ════════════════════════════════════ */
/* Minimal typings — lib.dom has none for Web Bluetooth. */
interface BtChar {
  properties: { write: boolean; writeWithoutResponse: boolean };
  writeValueWithoutResponse?(v: BufferSource): Promise<void>;
  writeValueWithResponse?(v: BufferSource): Promise<void>;
  writeValue(v: BufferSource): Promise<void>;
}
interface BtService {
  getCharacteristics(): Promise<BtChar[]>;
}
interface BtServer {
  connected: boolean;
  connect(): Promise<BtServer>;
  disconnect(): void;
  getPrimaryServices(): Promise<BtService[]>;
  getPrimaryService(uuid: string): Promise<BtService>;
}
interface BtDevice extends EventTarget {
  id: string;
  name?: string;
  gatt?: BtServer;
}
interface Bt {
  requestDevice(o: unknown): Promise<BtDevice>;
  getDevices?(): Promise<BtDevice[]>;
}
const bt = () => (navigator as unknown as { bluetooth: Bt }).bluetooth;

/**
 * GATT services that cheap ESC/POS thermal printers expose for their
 * "serial over BLE" data pipe. Web Bluetooth only lets the app open services
 * listed here, so the list covers the common printer chipsets.
 */
const PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb', // most 58/80 mm ESC/POS printers (char 2af1)
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // many unbranded mini printers
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // Microchip/ISSC transparent UART
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb', // HM-10 style modules
  '0000fee7-0000-1000-8000-00805f9b34fb',
  '0000ae30-0000-1000-8000-00805f9b34fb',
  '0000ff12-0000-1000-8000-00805f9b34fb',
];

let link: { device: BtDevice; char: BtChar; chunk: number } | null = null;
const btListeners = new Set<() => void>();
const btChanged = () => btListeners.forEach((l) => l());
export const useBtConnected = () =>
  useSyncExternalStore(
    (cb) => {
      btListeners.add(cb);
      return () => btListeners.delete(cb);
    },
    () => Boolean(link?.device.gatt?.connected),
  );

async function findWritable(server: BtServer): Promise<BtChar> {
  let services: BtService[] = [];
  try {
    services = await server.getPrimaryServices();
  } catch {
    for (const u of PRINTER_SERVICES) {
      try {
        services.push(await server.getPrimaryService(u));
      } catch {
        /* not on this printer */
      }
    }
  }
  for (const s of services) {
    try {
      const chars = await s.getCharacteristics();
      const c = chars.find((ch) => ch.properties.writeWithoutResponse) ?? chars.find((ch) => ch.properties.write);
      if (c) return c;
    } catch {
      /* next */
    }
  }
  throw new Error('This device has no printer data channel. Is it an ESC/POS thermal printer? Try “RawBT” or “Printer app” instead.');
}

async function open(device: BtDevice) {
  if (!device.gatt) throw new Error('This device does not support Bluetooth LE connections');
  const server = await device.gatt.connect();
  const char = await findWritable(server);
  device.addEventListener('gattserverdisconnected', () => {
    if (link?.device === device) link = null;
    btChanged();
  });
  link = { device, char, chunk: link?.device === device ? link.chunk : 512 };
  setPrinter({ btName: device.name || 'Bluetooth printer', btId: device.id });
  btChanged();
  return link;
}

/** Show the phone's Bluetooth chooser and connect. Must run from a tap. */
export async function pairBluetooth() {
  if (!hasWebBluetooth()) throw new Error(methodInfo('bluetooth').why);
  let device: BtDevice;
  try {
    device = await bt().requestDevice({ acceptAllDevices: true, optionalServices: PRINTER_SERVICES });
  } catch (e) {
    if ((e as Error).name === 'NotFoundError') throw new Error('No printer chosen');
    throw e;
  }
  return open(device);
}

export function forgetBluetooth() {
  try {
    link?.device.gatt?.disconnect();
  } catch {
    /* ignore */
  }
  link = null;
  setPrinter({ btName: undefined, btId: undefined });
  btChanged();
}

async function ensureLink() {
  if (link?.device.gatt?.connected) return link;
  if (link) return open(link.device); // known this session — just reconnect
  // Paired before (an earlier session): Chrome can hand the device back without the chooser.
  if (settings.btId && bt().getDevices) {
    try {
      const d = (await bt().getDevices!()).find((x) => x.id === settings.btId);
      if (d) return await open(d);
    } catch {
      /* fall through to the chooser */
    }
  }
  return pairBluetooth();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Write in chunks. The usable packet size depends on the printer and phone
 * (BLE MTU), which the web cannot read — so start large and step down on the
 * first failure. Writes without response are paced so the printer's small
 * buffer is not overrun (that prints garbage).
 */
async function sendBt(bytes: Uint8Array, onProgress?: (f: number) => void) {
  const l = await ensureLink();
  const noResp = l.char.properties.writeWithoutResponse;
  let size = l.chunk;
  let i = 0;
  while (i < bytes.length) {
    const part = bytes.slice(i, i + size);
    try {
      if (noResp && l.char.writeValueWithoutResponse) await l.char.writeValueWithoutResponse(part);
      else if (l.char.writeValueWithResponse) await l.char.writeValueWithResponse(part);
      else await l.char.writeValue(part);
    } catch (e) {
      if (!l.device.gatt?.connected) throw new Error('The printer disconnected. Check it is on and close by, then try again.');
      if (size > 20) {
        size = size > 180 ? 180 : 20;
        continue;
      }
      throw e;
    }
    i += part.length;
    onProgress?.(i / bytes.length);
    if (noResp) await sleep(Math.max(3, Math.round(size / 16)));
  }
  l.chunk = size;
}

/* ══ the other routes ═══════════════════════════════════════════════════ */
function b64(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const toBlob = (c: HTMLCanvasElement) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not create the image'))), 'image/png'));

export async function shareImage(canvas: HTMLCanvasElement, name: string) {
  const file = new File([await toBlob(canvas)], `${name}.png`, { type: 'image/png' });
  if (canShareFiles()) {
    try {
      await navigator.share({ files: [file], title: name });
      return 'Sent to the share sheet';
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new Error('Cancelled');
      throw e;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  return 'Image saved — open it in your printer app';
}

export async function systemPrint(canvas: HTMLCanvasElement, paper: Paper) {
  await printImage(canvas, paper - 6);
  return 'Sent to the print dialog';
}

/** Print the notice picture by the chosen route. Resolves with a short status line. */
export async function printCanvas(canvas: HTMLCanvasElement, name: string, method: PrintMethod = settings.method, onProgress?: (f: number) => void): Promise<string> {
  switch (method) {
    case 'bluetooth':
      await sendBt(canvasToEscPos(canvas), onProgress);
      return `Printed on ${settings.btName ?? 'the Bluetooth printer'}`;
    case 'rawbt':
      window.location.href = `intent:base64,${b64(canvasToEscPos(canvas))}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`;
      return 'Sent to RawBT';
    case 'share':
      return shareImage(canvas, name);
    case 'system':
      return systemPrint(canvas, settings.paper);
  }
}
