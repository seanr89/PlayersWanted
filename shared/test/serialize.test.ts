import { describe, expect, it } from 'vitest';
import { gameFromData, participantFromData, profileFromData, toMillis } from '../src/serialize';
import { NOW } from './fixtures';

const ts = (ms: number) => ({ toMillis: () => ms });

describe('toMillis', () => {
  it('accepts numbers, timestamp-likes and null', () => {
    expect(toMillis(5)).toBe(5);
    expect(toMillis(ts(7))).toBe(7);
    expect(toMillis(null)).toBeNull();
    expect(toMillis(undefined)).toBeNull();
  });

  it('rejects anything else', () => {
    expect(() => toMillis('2026-01-01')).toThrow();
  });
});

describe('gameFromData', () => {
  it('converts timestamps and fills defaults', () => {
    const game = gameFromData('g1', {
      organiserUid: 'org',
      organiserName: 'Org',
      venueId: 'v1',
      venue: { name: 'Leisure Centre', address: '1 High St', areaId: 'town' },
      areaId: 'town',
      startsAt: ts(NOW),
      durationMins: 60,
      format: '5v5',
      capacity: 10,
      costPerPlayerPence: 500,
      status: 'scheduled',
      createdAt: ts(NOW),
      updatedAt: ts(NOW),
    });
    expect(game.id).toBe('g1');
    expect(game.startsAt).toBe(NOW);
    expect(game.notes).toBeNull();
    expect(game.reminderSentAt).toBeNull();
    expect(game.confirmedCount).toBe(0);
    expect(game.waitlistCount).toBe(0);
    expect(game.venue.mapsUrl).toBeNull();
  });
});

describe('participantFromData', () => {
  it('converts timestamps', () => {
    const p = participantFromData({
      uid: 'u1',
      displayName: 'U1',
      gameStartsAt: ts(NOW),
      state: 'waitlisted',
      joinedAt: ts(NOW - 5),
      paid: false,
    });
    expect(p).toEqual({
      uid: 'u1',
      displayName: 'U1',
      gameStartsAt: NOW,
      state: 'waitlisted',
      joinedAt: NOW - 5,
      paid: false,
      paidUpdatedAt: null,
    });
  });
});

describe('profileFromData', () => {
  it('defaults notification preferences to email on, push off', () => {
    const p = profileFromData({ displayName: 'Sam', email: 'sam@example.com', homeAreaId: 'town' });
    expect(p.notify).toEqual({ email: true, push: false });
    expect(p.photoURL).toBeNull();
  });
});
