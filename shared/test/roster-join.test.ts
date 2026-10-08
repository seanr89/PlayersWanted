import { describe, expect, it } from 'vitest';
import { planJoin, sortWaitlist } from '../src/roster';
import { confirmedPlayers, expectDomainError, makeGame, makeParticipant, NOW } from './fixtures';

const joiner = { uid: 'new', displayName: 'New Player' };

describe('planJoin', () => {
  it('confirms when there is space', () => {
    const game = makeGame({ capacity: 10 });
    const plan = planJoin(game, confirmedPlayers(3), joiner, NOW);
    expect(plan.noop).toBe(false);
    expect(plan.add).toEqual({
      uid: 'new',
      displayName: 'New Player',
      gameStartsAt: game.startsAt,
      state: 'confirmed',
      joinedAt: NOW,
      paid: false,
      paidUpdatedAt: null,
    });
    expect(plan.confirmedCount).toBe(4);
    expect(plan.waitlistCount).toBe(0);
    expect(plan.promoteUids).toEqual([]);
  });

  it('waitlists when full', () => {
    const plan = planJoin(makeGame({ capacity: 10 }), confirmedPlayers(10), joiner, NOW);
    expect(plan.add?.state).toBe('waitlisted');
    expect(plan.confirmedCount).toBe(10);
    expect(plan.waitlistCount).toBe(1);
  });

  it('counts from the participant list, not the stored counters', () => {
    const plan = planJoin(makeGame({ capacity: 6, confirmedCount: 99 }), confirmedPlayers(2), joiner, NOW);
    expect(plan.add?.state).toBe('confirmed');
    expect(plan.confirmedCount).toBe(3);
  });

  it('is a no-op when already a participant (double tap / retry)', () => {
    const players = [...confirmedPlayers(2), makeParticipant('new', 'waitlisted')];
    const plan = planJoin(makeGame(), players, joiner, NOW);
    expect(plan.noop).toBe(true);
    expect(plan.add).toBeNull();
    expect(plan.confirmedCount).toBe(2);
    expect(plan.waitlistCount).toBe(1);
  });

  it('rejects a cancelled game', () => {
    expectDomainError(() => planJoin(makeGame({ status: 'cancelled' }), [], joiner, NOW), 'failed-precondition');
  });

  it('rejects a game that has started', () => {
    const game = makeGame({ startsAt: NOW });
    expectDomainError(() => planJoin(game, [], joiner, NOW), 'failed-precondition');
  });

  it('allows a started game when allowStarted is set', () => {
    const plan = planJoin(makeGame({ startsAt: NOW - 1 }), [], joiner, NOW, { allowStarted: true });
    expect(plan.add?.state).toBe('confirmed');
  });
});

describe('sortWaitlist', () => {
  it('orders waitlisted players by joinedAt then uid, ignoring confirmed', () => {
    const list = sortWaitlist([
      makeParticipant('b', 'waitlisted', NOW + 5),
      makeParticipant('c', 'confirmed', NOW),
      makeParticipant('z', 'waitlisted', NOW + 1),
      makeParticipant('a', 'waitlisted', NOW + 5),
    ]);
    expect(list.map((p) => p.uid)).toEqual(['z', 'a', 'b']);
  });
});
