/**
 * Emulator:    npm run seed
 * Production:  npm run seed -- --areas-only --project <project-id>   (needs `gcloud auth application-default login`)
 */
import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
const projectFlag = args.indexOf('--project');
const projectId = projectFlag >= 0 ? args[projectFlag + 1] : 'demo-playerswanted';
const areasOnly = args.includes('--areas-only');
const isDemo = projectId.startsWith('demo-');

if (!isDemo && !areasOnly) {
  console.error('Refusing to seed sample users/games into a real project. Use --areas-only.');
  process.exit(1);
}
if (isDemo) {
  process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
}

initializeApp({ projectId });
const db = getFirestore();
const now = Date.now();
const HOUR = 3_600_000;

const areas: { id: string; name: string; order: number }[] = JSON.parse(
  readFileSync(new URL('./areas.json', import.meta.url), 'utf8'),
);

async function main() {
  for (const a of areas) await db.doc(`areas/${a.id}`).set({ name: a.name, order: a.order });
  console.log(`Seeded ${areas.length} areas into ${projectId}`);
  if (areasOnly) return;

  const home = areas[0].id;
  const venues = [
    { id: 'leisure-centre', name: 'Leisure Centre', address: '1 High St' },
    { id: 'astro-park', name: 'Astro Park', address: '2 Park Rd' },
  ];
  for (const v of venues) {
    await db.doc(`venues/${v.id}`).set({
      name: v.name,
      address: v.address,
      areaId: home,
      createdBy: 'seed',
      createdAt: Timestamp.now(),
    });
  }

  const auth = getAuth();
  const users = ['Olly Organiser', 'Alice', 'Bob', 'Carol', 'Dan', 'Erin'];
  const uids: string[] = [];
  for (const name of users) {
    const email = `${name.split(' ')[0].toLowerCase()}@example.com`;
    const user = await auth.getUserByEmail(email).catch(() => auth.createUser({ email, displayName: name }));
    uids.push(user.uid);
    await db.doc(`users/${user.uid}`).set({
      displayName: name,
      email,
      photoURL: null,
      homeAreaId: home,
      notify: { email: true, push: false },
      createdAt: Timestamp.now(),
    });
  }

  const [organiser, ...players] = uids;
  const gameRef = db.collection('games').doc('seed-game');
  const startsAt = Timestamp.fromMillis(now + 26 * HOUR);
  await gameRef.set({
    organiserUid: organiser,
    organiserName: users[0],
    venueId: venues[0].id,
    venue: { name: venues[0].name, address: venues[0].address, areaId: home, mapsUrl: null },
    areaId: home,
    startsAt,
    durationMins: 60,
    format: '5v5',
    capacity: 10,
    costPerPlayerPence: 500,
    notes: 'Seeded game',
    status: 'scheduled',
    confirmedCount: players.length,
    waitlistCount: 0,
    reminderSentAt: null,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  for (const [i, uid] of players.entries()) {
    await gameRef.collection('participants').doc(uid).set({
      uid,
      displayName: users[i + 1],
      gameStartsAt: startsAt,
      state: 'confirmed',
      joinedAt: Timestamp.fromMillis(now + i),
      paid: false,
      paidUpdatedAt: null,
    });
  }
  console.log('Seeded venues, users and one game. Sign in at the Auth emulator with e.g. alice@example.com.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
