/**
 * The demo accounts built into the stand-alone phone app (CABLE_ONLY builds).
 *
 * Normally the first sign-in on a phone must reach the server, which checks
 * the password and gives the phone what it needs to sign in offline later.
 * The cable-only demo app never reaches a server, so it ships with the same
 * demo accounts the laptop (Hub) starts with — guard1 … guard4 and the
 * supervisor — and checks the shared demo password against a PBKDF2 verifier
 * (the password itself is not in the app).
 *
 * Demo only. In production the laptop enrols each phone over the cable and
 * writes that guard's own verifier (OFFLINE-ARCHITECTURE.md §7.1).
 */
import type { User } from '../../lib/api';
import { passwordMatches } from './offlineAuth';

const DEMO_PASSWORD_VERIFIER = { salt: '0voy4M22iWBy+Oc+1EOKeQ==', verifier: 'GFztr/QAMtp+lSPGH8o/aRnDge+lWPXqbDbMMVFI76Q=', iterations: 150_000 };

/** Same ids, names and areas as server/lib/seed.js, so tickets land under the right guard on the laptop. */
const DEMO_USERS: User[] = [
  { id: 'guard1', name: 'Rashid Ahmed', role: 'guard', area: 'markaziyah', phone: '+971 50 000 0111', active: true },
  { id: 'guard2', name: 'Imran Shaikh', role: 'guard', area: 'reem', phone: '+971 50 000 0112', active: true },
  { id: 'guard3', name: 'Joseph Mathew', role: 'guard', area: 'khalidiyah', phone: '+971 50 000 0113', active: true },
  { id: 'guard4', name: 'Bilal Hussain', role: 'guard', area: 'yas', phone: '+971 50 000 0114', active: true },
  { id: 'supervisor', name: 'Khalid Al Mansoori', role: 'supervisor', area: 'markaziyah', phone: '+971 50 000 0101', active: true },
];

/** The built-in account, if the id and password match; 'unknown' for an id that is not a demo account. */
export async function demoSignIn(id: string, password: string): Promise<User | null | 'unknown'> {
  const user = DEMO_USERS.find((u) => u.id === id.trim().toLowerCase());
  if (!user) return 'unknown';
  const v = DEMO_PASSWORD_VERIFIER;
  return (await passwordMatches(password, v.salt, v.verifier, v.iterations)) ? user : null;
}
