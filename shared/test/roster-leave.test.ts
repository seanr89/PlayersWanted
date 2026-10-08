import { describe, expect, it } from 'vitest';
import { planCapacityChange, planLeave } from '../src/roster';
import { confirmedPlayers, expectDomainError, makeGame, makeParticipant, NOW } from './fixtures';

const fullWithWaitlist = () => [
  ...confirmedPlayers(10),
  makeParticipant('w-late', 'waitlisted', NOW + 300),
  makeParticipant('w-early', 'waitlisted', NOW + 100),
  makeParticipant('w-mid', 'waitlisted', NOW + 200),
];

describe('planLeave', () => {
  it('removes a confirmed player with no waitlist', () => {
    const plan = planLeave(makeGame(), confirmedPlayers(4), 'c1');
    expect(plan.removed?.uid).toBe('c1');
    expect(plan.promoteUids).toEqual([]);
    expect(plan.confirmedCount).toBe(3);
    expect(plan.waitlistCount).toBe(0);
  });

  it('promotes the earliest waitlisted player when a confirmed player leaves', () => {
    const plan = planLeave(makeGame({ capacity: 10 }), fullWithWaitlist(), 'c3');
    expect(plan.promoteUids).toEqual(['w-early']);
    expect(plan.confirmedCount).toBe(10);
    expect(plan.waitlistCount).toBe(2);
  });

  it('does not promote when a waitlisted player leaves', () => {
    const plan = planLeave(makeGame({ capacity: 10 }), fullWithWaitlist(), 'w-mid');
    expect(plan.promoteUids).toEqual([]);
    expect(plan.confirmedCount).toBe(10);
    expect(plan.waitlistCount).toBe(2);
  });

  it('is a no-op for someone not on the roster', () => {
    const plan = planLeave(makeGame(), confirmedPlayers(2), 'stranger');
    expect(plan.noop).toBe(true);
    expect(plan.removed).toBeNull();
    expect(plan.confirmedCount).toBe(2);
  });
});

describe('planCapacityChange', () => {
  it('promotes waitlisted players in order when capacity rises', () => {
    const plan = planCapacityChange(makeGame({ capacity: 10 }), fullWithWaitlist(), 12);
    expect(plan.promoteUids).toEqual(['w-early', 'w-mid']);
    expect(plan.confirmedCount).toBe(12);
    expect(plan.waitlistCount).toBe(1);
  });

  it('promotes everyone when capacity rises past the waitlist', () => {
    const plan = planCapacityChange(makeGame({ capacity: 10 }), fullWithWaitlist(), 22);
    expect(plan.promoteUids).toEqual(['w-early', 'w-mid', 'w-late']);
    expect(plan.waitlistCount).toBe(0);
  });

  it('rejects capacity below the confirmed count', () => {
    const err = expectDomainError(() => planCapacityChange(makeGame({ capacity: 10 }), confirmedPlayers(8), 6), 'failed-precondition');
    expect(err.message).toContain('8');
  });

  it('allows capacity equal to the confirmed count', () => {
    const plan = planCapacityChange(makeGame({ capacity: 10 }), confirmedPlayers(8), 8);
    expect(plan.promoteUids).toEqual([]);
    expect(plan.confirmedCount).toBe(8);
  });

  it('is a no-op when capacity is unchanged', () => {
    expect(planCapacityChange(makeGame({ capacity: 10 }), confirmedPlayers(3), 10).noop).toBe(true);
  });
});
