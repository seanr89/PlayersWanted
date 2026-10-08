import { describe, expect, it } from 'vitest';
import { requireId, validateGameInput } from '../src/validation';
import { DAY, expectDomainError, HOUR, NOW } from './fixtures';

const valid = {
  venueId: 'v1',
  startsAt: NOW + DAY,
  durationMins: 60,
  format: '5v5',
  capacity: 10,
  costPerPlayerPence: 500,
  notes: '  Bring both bibs  ',
};

describe('validateGameInput', () => {
  it('accepts valid input and normalises notes', () => {
    expect(validateGameInput(valid, NOW)).toEqual({ ...valid, notes: 'Bring both bibs' });
  });

  it('turns blank or missing notes into null', () => {
    expect(validateGameInput({ ...valid, notes: '   ' }, NOW).notes).toBeNull();
    const withoutNotes: Record<string, unknown> = { ...valid };
    delete withoutNotes.notes;
    expect(validateGameInput(withoutNotes, NOW).notes).toBeNull();
  });

  it.each([
    ['not an object', 'nope'],
    ['missing venueId', { ...valid, venueId: '' }],
    ['start in the past', { ...valid, startsAt: NOW - 1 }],
    ['start more than 90 days ahead', { ...valid, startsAt: NOW + 90 * DAY + 1 }],
    ['non-integer start', { ...valid, startsAt: NOW + 0.5 }],
    ['duration too short', { ...valid, durationMins: 29 }],
    ['duration too long', { ...valid, durationMins: 181 }],
    ['capacity too small', { ...valid, capacity: 4 }],
    ['capacity too big', { ...valid, capacity: 24 }],
    ['odd capacity', { ...valid, capacity: 11 }],
    ['negative cost', { ...valid, costPerPlayerPence: -1 }],
    ['cost too high', { ...valid, costPerPlayerPence: 5001 }],
    ['fractional cost', { ...valid, costPerPlayerPence: 4.5 }],
    ['notes too long', { ...valid, notes: 'x'.repeat(501) }],
    ['unknown format', { ...valid, format: '11v11' }],
  ])('rejects %s', (_label, input) => {
    expectDomainError(() => validateGameInput(input, NOW), 'invalid-argument');
  });

  it('accepts the boundaries', () => {
    expect(() =>
      validateGameInput({ ...valid, startsAt: NOW + 90 * DAY, durationMins: 30, capacity: 6, costPerPlayerPence: 0 }, NOW),
    ).not.toThrow();
    expect(() => validateGameInput({ ...valid, durationMins: 180, capacity: 22, costPerPlayerPence: 5000 }, NOW)).not.toThrow();
  });

  it('allows an unchanged start time that is already in the past (editing after kick-off)', () => {
    const started = NOW - HOUR;
    expect(validateGameInput({ ...valid, startsAt: started }, NOW, { existingStartsAt: started }).startsAt).toBe(started);
  });

  it('rejects moving an existing game to a different past time', () => {
    expectDomainError(
      () => validateGameInput({ ...valid, startsAt: NOW - 2 * HOUR }, NOW, { existingStartsAt: NOW - HOUR }),
      'invalid-argument',
    );
  });
});

describe('requireId', () => {
  it('returns a valid id', () => {
    expect(requireId({ gameId: 'abc' }, 'gameId')).toBe('abc');
  });

  it.each([undefined, null, 'abc', { gameId: '' }, { gameId: 5 }, { gameId: 'a/b' }, { gameId: 'x'.repeat(129) }])(
    'rejects %j',
    (raw) => {
      expectDomainError(() => requireId(raw, 'gameId'), 'invalid-argument');
    },
  );
});
