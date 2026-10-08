import { DomainError, profileFromData, type UserProfile } from '@pw/shared';
import type { Firestore } from 'firebase-admin/firestore';

export async function requireProfile(db: Firestore, uid: string): Promise<UserProfile> {
  const snap = await db.doc(`users/${uid}`).get();
  if (!snap.exists) throw new DomainError('failed-precondition', 'Finish setting up your profile first.');
  return profileFromData(snap.data()!);
}
