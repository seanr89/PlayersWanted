import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../src/lib/admin';
import type { CallContext } from '../../src/lib/callable';

export const PROJECT_ID = 'demo-playerswanted';
export const NOW = Date.UTC(2026, 9, 1, 12, 0);
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export { db };

export async function clearFirestore(): Promise<void> {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error('FIRESTORE_EMULATOR_HOST is not set — run via `npm run test:emulators`.');
  const res = await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`Failed to clear Firestore emulator: ${res.status}`);
}

export function ctxFor(uid: string, opts: { now?: number; isAdmin?: boolean } = {}): CallContext {
  return { uid, isAdmin: opts.isAdmin ?? false, db, now: opts.now ?? NOW };
}

export async function seedArea(id = 'town'): Promise<void> {
  await db.doc(`areas/${id}`).set({ name: 'Town', order: 1 });
}

export async function seedUser(uid: string, displayName = uid, extra: Record<string, unknown> = {}): Promise<void> {
  await db.doc(`users/${uid}`).set({
    displayName,
    email: `${uid}@example.com`,
    photoURL: null,
    homeAreaId: 'town',
    notify: { email: true, push: false },
    createdAt: Timestamp.fromMillis(NOW),
    ...extra,
  });
}

export async function seedVenue(id = 'v1', data: Record<string, unknown> = {}): Promise<void> {
  await db.doc(`venues/${id}`).set({
    name: 'Leisure Centre',
    address: '1 High St',
    areaId: 'town',
    createdBy: 'seed',
    createdAt: Timestamp.fromMillis(NOW),
    ...data,
  });
}

export function gameInput(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    venueId: 'v1',
    startsAt: NOW + 2 * DAY,
    durationMins: 60,
    format: '5v5',
    capacity: 10,
    costPerPlayerPence: 500,
    notes: null,
    ...over,
  };
}
