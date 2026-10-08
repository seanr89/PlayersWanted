import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

let env: RulesTestEnvironment;
const now = Timestamp.fromMillis(Date.UTC(2026, 9, 1, 12));

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-playerswanted',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'areas/town'), { name: 'Town', order: 1 });
    await setDoc(doc(db, 'games/g1'), { organiserUid: 'org', areaId: 'town', status: 'scheduled', startsAt: now });
    await setDoc(doc(db, 'games/g1/participants/alice'), { uid: 'alice', state: 'confirmed', gameStartsAt: now });
    await setDoc(doc(db, 'users/bob'), {
      displayName: 'Bob',
      email: 'bob@example.com',
      homeAreaId: 'town',
      notify: { email: true, push: false },
      createdAt: now,
    });
  });
});

const anon = () => env.unauthenticatedContext().firestore();
const as = (uid: string) => env.authenticatedContext(uid, { email: `${uid}@example.com` }).firestore();

const profile = (uid: string) => ({
  displayName: 'Alice',
  email: `${uid}@example.com`,
  photoURL: null,
  homeAreaId: 'town',
  notify: { email: true, push: false },
  createdAt: serverTimestamp(),
});

describe('games and participants', () => {
  it('anyone can read a game', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'games/g1')));
  });

  it('anonymous users cannot read the roster', async () => {
    await assertFails(getDoc(doc(anon(), 'games/g1/participants/alice')));
  });

  it('signed-in users can read the roster', async () => {
    await assertSucceeds(getDoc(doc(as('carol'), 'games/g1/participants/alice')));
  });

  it('clients cannot write games or participants', async () => {
    await assertFails(setDoc(doc(as('org'), 'games/g2'), { organiserUid: 'org' }));
    await assertFails(updateDoc(doc(as('org'), 'games/g1'), { capacity: 99 }));
    await assertFails(setDoc(doc(as('alice'), 'games/g1/participants/alice'), { state: 'confirmed' }));
    await assertFails(deleteDoc(doc(as('alice'), 'games/g1/participants/alice')));
  });

  it('signed-in users can run the My games collection-group query', async () => {
    const q = query(collectionGroup(as('alice'), 'participants'), where('uid', '==', 'alice'));
    await assertSucceeds(getDocs(q));
  });

  it('anonymous users cannot run the collection-group query', async () => {
    const q = query(collectionGroup(anon(), 'participants'), where('uid', '==', 'alice'));
    await assertFails(getDocs(q));
  });
});

describe('users', () => {
  it('a user can create their own valid profile', async () => {
    await assertSucceeds(setDoc(doc(as('alice'), 'users/alice'), profile('alice')));
  });

  it('a user cannot create someone else’s profile', async () => {
    await assertFails(setDoc(doc(as('alice'), 'users/carol'), profile('carol')));
  });

  it('rejects a bad display name, unknown area, unknown field or wrong email', async () => {
    const db = as('alice');
    await assertFails(setDoc(doc(db, 'users/alice'), { ...profile('alice'), displayName: 'A' }));
    await assertFails(setDoc(doc(db, 'users/alice'), { ...profile('alice'), homeAreaId: 'nowhere' }));
    await assertFails(setDoc(doc(db, 'users/alice'), { ...profile('alice'), admin: true }));
    await assertFails(setDoc(doc(db, 'users/alice'), { ...profile('alice'), email: 'someone@else.com' }));
  });

  it('a user can update their notification settings but not createdAt', async () => {
    const db = as('bob');
    await assertSucceeds(updateDoc(doc(db, 'users/bob'), { 'notify.push': true }));
    await assertFails(updateDoc(doc(db, 'users/bob'), { createdAt: Timestamp.fromMillis(0) }));
  });

  it('users cannot read each other’s profiles', async () => {
    await assertFails(getDoc(doc(as('alice'), 'users/bob')));
    await assertSucceeds(getDoc(doc(as('bob'), 'users/bob')));
  });

  it('push tokens are owner-only', async () => {
    const token = { createdAt: serverTimestamp(), userAgent: 'test' };
    await assertSucceeds(setDoc(doc(as('bob'), 'users/bob/pushTokens/tok1'), token));
    await assertFails(setDoc(doc(as('alice'), 'users/bob/pushTokens/tok2'), token));
    await assertFails(getDoc(doc(as('alice'), 'users/bob/pushTokens/tok1')));
  });
});

describe('venues and areas', () => {
  const venue = (uid: string) => ({
    name: 'Leisure Centre',
    address: '1 High St',
    areaId: 'town',
    createdBy: uid,
    createdAt: serverTimestamp(),
  });

  it('anyone can read areas and venues', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'areas/town')));
    await assertSucceeds(getDocs(collection(anon(), 'venues')));
  });

  it('signed-in users can add a valid venue', async () => {
    await assertSucceeds(setDoc(doc(as('alice'), 'venues/v1'), venue('alice')));
    await assertSucceeds(
      setDoc(doc(as('alice'), 'venues/v2'), { ...venue('alice'), mapsUrl: 'https://maps.example.com/x' }),
    );
  });

  it('rejects venues from anonymous users, with another creator, an unknown area or a non-https map link', async () => {
    await assertFails(setDoc(doc(anon(), 'venues/v1'), venue('alice')));
    await assertFails(setDoc(doc(as('alice'), 'venues/v1'), venue('bob')));
    await assertFails(setDoc(doc(as('alice'), 'venues/v1'), { ...venue('alice'), areaId: 'nowhere' }));
    await assertFails(setDoc(doc(as('alice'), 'venues/v1'), { ...venue('alice'), mapsUrl: 'javascript:alert(1)' }));
  });

  it('clients cannot write areas', async () => {
    await assertFails(setDoc(doc(as('alice'), 'areas/new'), { name: 'New', order: 2 }));
  });
});
