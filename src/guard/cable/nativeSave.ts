/**
 * Android app only: save a ticket picture into the phone's shared Pictures
 * folder (Pictures/ParkPatrol) through the native CableSaver plugin
 * (android/app/src/main/java/xyz/astrikos/parkpatrol/CableSaverPlugin.java).
 * A laptop sees that folder over the USB cable in "File transfer" mode.
 * The Android WebView cannot download files or open the share sheet itself.
 */
import { registerPlugin } from '@capacitor/core';

interface CableSaverPlugin {
  savePng(options: { name: string; data: string }): Promise<{ folder: string }>;
}
const CableSaver = registerPlugin<CableSaverPlugin>('CableSaver');

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error ?? new Error('Could not read the picture'));
    r.readAsDataURL(blob);
  });

/** Returns the folder the laptop will find the picture in. */
export async function savePictureToPhone(name: string, blob: Blob): Promise<string> {
  const { folder } = await CableSaver.savePng({ name, data: await toBase64(blob) });
  return folder;
}
