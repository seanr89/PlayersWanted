import { beforeEach, describe, expect, it } from 'vitest';
import { cancelGameHandler, createGameHandler } from '../../src/games';
import { joinGameHandler, leaveGameHandler, removePlayerHandler, setPaidHandler } from '../../src/roster';
import { clearFirestore, ctxFor, db, gameInput, HOUR, NOW, seedArea, seedUser, seedVenue } from './helpers';

let gameId: string;

async function join(uid: string, offset: number) {
  await seedUser(uid);
  return joinGameHandler(ctxFor(uid, { now: NOW + offset }), { gameId });
}

const gameDoc = async () => (await db.doc(`games/${gameId}`).get()).data()!;
const participant = async (uid: string) => (await db.doc(`games/${gameId}/participants/${uid}`).get()).data();

beforeEach(async () => {
  await clearFirestore();
  await seedArea();
  await seedVenue();
  await seedUser('org', 'Olly');
  gameId = (await createGameHandler(ctxFor('org'), gameInput({ capacity: 6 }))).data.gameId;
});

describe('joinGame', () => {
  it('confirms and notifies the organiser', async () => {
    const { data, notices } = await join('alice', 1);
    expect(data.state).toBe('confirmed');
    expect(await gameDoc()).toMatchObject({ confirmedCount: 1, waitlistCount: 0 });
    expect(notices).toEqual([
      { uid: 'org', event: expect.objectContaining({ type: 'player_joined', playerName: 'alice', state: 'confirmed' }) },
    ]);
  });

  it('waitlists once full', async () => {
    for (let i = 0; i < 6; i++) await join(`p${i}`, i + 1);
    const { data } = await join('late', 10);
    expect(data.state).toBe('waitlisted');
    expect(await gameDoc()).toMatchObject({ confirmedCount: 6, waitlistCount: 1 });
  });

  it('joining twice is harmless', async () => {
    await join('alice', 1);
    const second = await joinGameHandler(ctxFor('alice', { now: NOW + 2 }), { gameId });
    expect(second.data.state).toBe('confirmed');
    expect(second.notices).toEqual([]);
    expect(await gameDoc()).toMatchObject({ confirmedCount: 1, waitlistCount: 0 });
  });

  it('does not notify the organiser about themselves', async () => {
    const { notices } = await joinGameHandler(ctxFor('org', { now: NOW + 1 }), { gameId });
    expect(notices).toEqual([]);
  });

  it('rejects cancelled and started games', async () => {
    await seedUser('alice');
    await expect(joinGameHandler(ctxFor('alice', { now: NOW + 3 * 24 * HOUR }), { gameId })).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    await cancelGameHandler(ctxFor('org'), { gameId });
    await expect(joinGameHandler(ctxFor('alice'), { gameId })).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('rejects a missing game', async () => {
    await seedUser('alice');
    await expect(joinGameHandler(ctxFor('alice'), { gameId: 'nope' })).rejects.toMatchObject({ code: 'not-found' });
  });

  it('N players racing for the last space: exactly one is confirmed', async () => {
    for (let i = 0; i < 5; i++) await join(`p${i}`, i + 1);
    const racers = Array.from({ length: 8 }, (_, i) => `racer${i}`);
    await Promise.all(racers.map((uid) => seedUser(uid)));
    const results = await Promise.allSettled(
      racers.map((uid, i) => joinGameHandler(ctxFor(uid, { now: NOW + 100 + i }), { gameId })),
    );
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const states = results.map((r) => (r as PromiseFulfilledResult<{ data: { state: string } }>).value.data.state);
    expect(states.filter((s) => s === 'confirmed')).toHaveLength(1);
    expect(states.filter((s) => s === 'waitlisted')).toHaveLength(7);
    expect(await gameDoc()).toMatchObject({ confirmedCount: 6, waitlistCount: 7 });
  });
});

describe('leaveGame', () => {
  it('promotes the earliest waitlisted player and notifies organiser and promoted player', async () => {
    for (let i = 0; i < 6; i++) await join(`p${i}`, i + 1);
    await join('w-early', 10);
    await join('w-late', 11);
    const { notices } = await leaveGameHandler(ctxFor('p2'), { gameId });
    expect(await participant('p2')).toBeUndefined();
    expect((await participant('w-early'))?.state).toBe('confirmed');
    expect((await participant('w-late'))?.state).toBe('waitlisted');
    expect(await gameDoc()).toMatchObject({ confirmedCount: 6, waitlistCount: 1 });
    expect(notices.map((n) => [n.uid, n.event.type])).toEqual([
      ['org', 'player_left'],
      ['w-early', 'promoted'],
    ]);
  });

  it('leaving when not on the roster is a no-op', async () => {
    await seedUser('alice');
    const { notices } = await leaveGameHandler(ctxFor('alice'), { gameId });
    expect(notices).toEqual([]);
  });

  it('cannot leave a cancelled game', async () => {
    await join('alice', 1);
    await cancelGameHandler(ctxFor('org'), { gameId });
    await expect(leaveGameHandler(ctxFor('alice'), { gameId })).rejects.toMatchObject({ code: 'failed-precondition' });
  });
});

describe('removePlayer', () => {
  it('removes, promotes and notifies the removed and promoted players', async () => {
    for (let i = 0; i < 6; i++) await join(`p${i}`, i + 1);
    await join('w', 10);
    const { notices } = await removePlayerHandler(ctxFor('org'), { gameId, uid: 'p0' });
    expect(await participant('p0')).toBeUndefined();
    expect((await participant('w'))?.state).toBe('confirmed');
    expect(notices.map((n) => [n.uid, n.event.type])).toEqual([
      ['p0', 'removed'],
      ['w', 'promoted'],
    ]);
  });

  it('only the organiser can remove', async () => {
    await join('alice', 1);
    await join('bob', 2);
    await expect(removePlayerHandler(ctxFor('bob'), { gameId, uid: 'alice' })).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });
});

describe('setPaid', () => {
  it('toggles paid on a confirmed player', async () => {
    await join('alice', 1);
    await setPaidHandler(ctxFor('org'), { gameId, uid: 'alice', paid: true });
    expect(await participant('alice')).toMatchObject({ paid: true });
    expect((await participant('alice'))?.paidUpdatedAt).not.toBeNull();
    await setPaidHandler(ctxFor('org'), { gameId, uid: 'alice', paid: false });
    expect(await participant('alice')).toMatchObject({ paid: false });
  });

  it('rejects waitlisted players, non-organisers and bad input', async () => {
    for (let i = 0; i < 6; i++) await join(`p${i}`, i + 1);
    await join('w', 10);
    await expect(setPaidHandler(ctxFor('org'), { gameId, uid: 'w', paid: true })).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    await expect(setPaidHandler(ctxFor('p1'), { gameId, uid: 'p0', paid: true })).rejects.toMatchObject({
      code: 'permission-denied',
    });
    await expect(setPaidHandler(ctxFor('org'), { gameId, uid: 'p0', paid: 'yes' })).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    await expect(setPaidHandler(ctxFor('org'), { gameId, uid: 'nobody', paid: true })).rejects.toMatchObject({
      code: 'not-found',
    });
  });
});
