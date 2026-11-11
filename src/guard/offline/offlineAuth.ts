/**
 * Sign-in that works with no network.
 *
 * The first sign-in of a guard on a phone must reach the server — that is the
 * only place the password can be checked. When it succeeds, the phone keeps:
 *   • a PBKDF2 verifier of the password (WebCrypto, 150k iterations, random
 *     salt) — NEVER the password itself;
 *   • the guard's profile, and the server token used later to upload.
 * After that, the same guard can sign in offline: the typed password is run
 * through the same derivation and compared.
 *
 * Each guard who has signed in on this phone has their own entry, so a shared
 * handset works across shift changes, and each record uploads with the token
 * of the guard who captured it.
 *
 * iPhone NOTE: an app added to the Home Screen has storage separate from
 * Safari. Sign in once INSIDE the installed app while online, not just in the
 * Safari tab, before relying on offline sign-in there.
 */
import { kvGet, kvSet, kvDel } from './db';
import type { User } from '../../lib/api';

const ITERATIONS = 150_000;

export interface OfflineCredential {
  userId: string;
  salt: string; // base64
  verifier: string; // base64 PBKDF2-SHA256
  iterations: number;
  user: User;
  token: string | null; // null after the server rejected it — sign in online again
  savedAt: number;
}

export interface Session {
  user: User;
  offline: boolean; // signed in without reaching the server
  at: number;
}

const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf instanceof Uint8Array ? buf : new Uint8Array(buf))));
const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}

const credKey = (id: string) => `cred:${id.trim().toLowerCase()}`;

export async function rememberCredential(password: string, user: User, token: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const verifier = await derive(password, salt, ITERATIONS);
  const cred: OfflineCredential = { userId: user.id, salt: b64(salt), verifier: b64(verifier), iterations: ITERATIONS, user, token, savedAt: Date.now() };
  await kvSet(credKey(user.id), cred);
}

export async function credentialFor(userId: string) {
  return kvGet<OfflineCredential>(credKey(userId));
}

/** Returns the stored user when the password matches the stored verifier; null otherwise. */
export async function verifyOffline(username: string, password: string): Promise<OfflineCredential | null | 'unknown'> {
  const cred = await credentialFor(username);
  if (!cred) return 'unknown';
  const got = new Uint8Array(await derive(password, unb64(cred.salt), cred.iterations));
  const want = unb64(cred.verifier);
  if (got.length !== want.length) return null;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0 ? cred : null;
}

/** The server said this guard's token is no longer valid: keep the offline verifier, drop the token. */
export async function invalidateToken(userId: string) {
  const cred = await credentialFor(userId);
  if (cred) await kvSet(credKey(userId), { ...cred, token: null });
}

export async function forgetCredential(userId: string) {
  await kvDel(credKey(userId));
}

export const getSession = () => kvGet<Session>('session');
export const setSession = (s: Session) => kvSet('session', s);
export const clearSession = () => kvDel('session');
export const lastUsername = () => kvGet<string>('lastUsername');
export const setLastUsername = (u: string) => kvSet('lastUsername', u);
