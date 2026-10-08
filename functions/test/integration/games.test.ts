import { beforeEach, describe, expect, it } from 'vitest';
import { cancelGameHandler, createGameHandler, updateGameHandler } from '../../src/games';
import { joinGameHandler } from '../../src/roster';
import { clearFirestore, ctxFor, DAY, db, gameInput, HOUR, NOW, seedArea, seedUser, seedVenue } from './helpers';

async function createGame(over: Record<string, unknown> = {}) {
  const { data } = await createGameHandler(ctxFor('org'), gameInput(over));
  return data.gameId;
}

async function join(gameId: string, uid: string, offset: number) {
  await seedUser(uid);
  await joinGameHandler(ctxFor(uid, { now: NOW + offset }), { gameId });
}

const gameDoc = async (id: string) => (await db.doc(`games/${id}`).get()).data()!;
const participant = async (id: string, uid: string) => (await db.doc(`games/${id}/participants/${uid}`).get()).data();

describe('createGame', () => {
  beforeEach(async () => {
    await clearFirestore();
    await seedArea();
    await seedVenue();
    await seedUser('org', 'Olly');
  });

  it('creates a scheduled game with a venue snapshot and no players', async () => {
    const id = await createGame();
    const game = await gameDoc(id);
    expect(game).toMatchObject({
      organiserUid: 'org',
      organiserName: 'Olly',
      status: 'scheduled',
      areaId: 'town',
      venue: { name: 'Leisure Centre', address: '1 High St', areaId: 'town', mapsUrl: null },
      confirmedCount: 0,
      waitlistCount: 0,
      reminderSentAt: null,
    });
    expect(game.startsAt.toMillis()).toBe(NOW + 2 * DAY);
    expect((await db.collection(`games/${id}/participants`).get()).size).toBe(0);
  });

  it('rejects a caller without a profile', async () => {
    await expect(createGameHandler(ctxFor('ghost'), gameInput())).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('rejects an unknown venue', async () => {
    await expect(createGameHandler(ctxFor('org'), gameInput({ venueId: 'nope' }))).rejects.toMatchObject({
      code: 'not-found',
    });
  });

  it('rejects invalid input', async () => {
    await expect(createGameHandler(ctxFor('org'), gameInput({ capacity: 7 }))).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });
});

describe('updateGame', () => {
  beforeEach(async () => {
    await clearFirestore();
    await seedArea();
    await seedVenue();
    await seedVenue('v2', { name: 'Astro Park', address: '2 Low Rd' });
    await seedUser('org', 'Olly');
  });

  it('only the organiser can edit', async () => {
    const id = await createGame();
    await seedUser('mallory');
    await expect(updateGameHandler(ctxFor('mallory'), { gameId: id, ...gameInput() })).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it('raising capacity promotes waitlisted players in order and notifies them', async () => {
    const id = await createGame({ capacity: 6 });
    for (let i = 0; i < 9; i++) await join(id, `p${i}`, i + 1);
    const { notices } = await updateGameHandler(ctxFor('org'), { gameId: id, ...gameInput({ capacity: 8 }) });
    expect((await participant(id, 'p6'))?.state).toBe('confirmed');
    expect((await participant(id, 'p7'))?.state).toBe('confirmed');
    expect((await participant(id, 'p8'))?.state).toBe('waitlisted');
    expect(await gameDoc(id)).toMatchObject({ capacity: 8, confirmedCount: 8, waitlistCount: 1 });
    expect(notices.filter((n) => n.event.type === 'promoted').map((n) => n.uid)).toEqual(['p6', 'p7']);
  });

  it('rejects capacity below the confirmed count', async () => {
    const id = await createGame({ capacity: 10 });
    for (let i = 0; i < 8; i++) await join(id, `p${i}`, i + 1);
    await expect(updateGameHandler(ctxFor('org'), { gameId: id, ...gameInput({ capacity: 6 }) })).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });

  it('a time change updates participants, resets the reminder and notifies everyone', async () => {
    const id = await createGame();
    await join(id, 'a', 1);
    await join(id, 'b', 2);
    await db.doc(`games/${id}`).update({ reminderSentAt: new Date(NOW) });
    const newStart = NOW + 3 * DAY;
    const { notices } = await updateGameHandler(ctxFor('org'), { gameId: id, ...gameInput({ startsAt: newStart }) });
    expect((await participant(id, 'a'))?.gameStartsAt.toMillis()).toBe(newStart);
    expect((await participant(id, 'b'))?.gameStartsAt.toMillis()).toBe(newStart);
    expect((await gameDoc(id)).reminderSentAt).toBeNull();
    expect(notices.filter((n) => n.event.type === 'game_changed').map((n) => n.uid).sort()).toEqual(['a', 'b']);
  });

  it('a venue change re-snapshots the venue and notifies participants', async () => {
    const id = await createGame();
    await join(id, 'a', 1);
    const { notices } = await updateGameHandler(ctxFor('org'), { gameId: id, ...gameInput({ venueId: 'v2' }) });
    expect((await gameDoc(id)).venue.name).toBe('Astro Park');
    expect(notices.map((n) => n.event.type)).toEqual(['game_changed']);
  });

  it('allows editing after kick-off when the time is unchanged', async () => {
    const start = NOW + HOUR;
    const id = await createGame({ startsAt: start });
    const later = NOW + 2 * HOUR;
    await expect(
      updateGameHandler(ctxFor('org', { now: later }), { gameId: id, ...gameInput({ startsAt: start, venueId: 'v2' }) }),
    ).resolves.toBeDefined();
  });

  it('sends no change notices for a notes-only edit', async () => {
    const id = await createGame();
    await join(id, 'a', 1);
    const { notices } = await updateGameHandler(ctxFor('org'), { gameId: id, ...gameInput({ notes: 'Bring bibs' }) });
    expect(notices).toEqual([]);
  });
});

describe('cancelGame', () => {
  beforeEach(async () => {
    await clearFirestore();
    await seedArea();
    await seedVenue();
    await seedUser('org', 'Olly');
  });

  it('cancels, notifies every participant and blocks further edits', async () => {
    const id = await createGame();
    await join(id, 'a', 1);
    const { notices } = await cancelGameHandler(ctxFor('org'), { gameId: id });
    expect((await gameDoc(id)).status).toBe('cancelled');
    expect(notices).toEqual([{ uid: 'a', event: expect.objectContaining({ type: 'game_cancelled', gameId: id }) }]);
    await expect(updateGameHandler(ctxFor('org'), { gameId: id, ...gameInput() })).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });

  it('is idempotent', async () => {
    const id = await createGame();
    await join(id, 'a', 1);
    await cancelGameHandler(ctxFor('org'), { gameId: id });
    const second = await cancelGameHandler(ctxFor('org'), { gameId: id });
    expect(second.notices).toEqual([]);
  });

  it('only the organiser can cancel', async () => {
    const id = await createGame();
    await expect(cancelGameHandler(ctxFor('a'), { gameId: id })).rejects.toMatchObject({ code: 'permission-denied' });
  });
});
