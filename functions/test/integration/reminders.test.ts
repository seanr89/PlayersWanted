import { beforeEach, describe, expect, it } from 'vitest';
import { cancelGameHandler, createGameHandler } from '../../src/games';
import { runReminders } from '../../src/reminders';
import { joinGameHandler } from '../../src/roster';
import { clearFirestore, ctxFor, db, gameInput, HOUR, NOW, seedArea, seedUser, seedVenue } from './helpers';

const MIN = 60_000;

async function gameStartingIn(ms: number, capacity = 6) {
  const { data } = await createGameHandler(ctxFor('org'), gameInput({ startsAt: NOW + ms, capacity }));
  return data.gameId;
}

beforeEach(async () => {
  await clearFirestore();
  await seedArea();
  await seedVenue();
  await seedUser('org');
});

describe('runReminders', () => {
  it('reminds confirmed players (not the waitlist) once', async () => {
    const id = await gameStartingIn(24 * HOUR - 10 * MIN);
    for (let i = 0; i < 7; i++) {
      await seedUser(`p${i}`);
      await joinGameHandler(ctxFor(`p${i}`, { now: NOW + i }), { gameId: id });
    }
    const first = await runReminders(db, NOW);
    expect(first.map((n) => n.uid).sort()).toEqual(['p0', 'p1', 'p2', 'p3', 'p4', 'p5']);
    expect(first.every((n) => n.event.type === 'reminder')).toBe(true);
    expect((await db.doc(`games/${id}`).get()).data()!.reminderSentAt).not.toBeNull();

    expect(await runReminders(db, NOW + 15 * MIN)).toEqual([]);
  });

  it('still reminds when a run was delayed (game now 23h10m away)', async () => {
    const id = await gameStartingIn(23 * HOUR + 10 * MIN);
    await seedUser('a');
    await joinGameHandler(ctxFor('a'), { gameId: id });
    expect((await runReminders(db, NOW)).map((n) => n.uid)).toEqual(['a']);
  });

  it('ignores games too far away and cancelled games', async () => {
    await gameStartingIn(25 * HOUR);
    const cancelled = await gameStartingIn(23 * HOUR + 30 * MIN);
    await seedUser('a');
    await joinGameHandler(ctxFor('a'), { gameId: cancelled });
    await cancelGameHandler(ctxFor('org'), { gameId: cancelled });
    expect(await runReminders(db, NOW)).toEqual([]);
  });
});
