import { expect } from 'vitest';
import { DomainError, type DomainErrorCode } from '../src/errors';
import type { Game, Participant, ParticipantState } from '../src/types';

export const NOW = Date.UTC(2026, 9, 1, 12, 0); // Thu 1 Oct 2026 12:00 UTC
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export function makeGame(over: Partial<Game> = {}): Game {
  return {
    id: 'g1',
    organiserUid: 'org',
    organiserName: 'Olly Organiser',
    venueId: 'v1',
    venue: { name: 'Leisure Centre', address: '1 High St', areaId: 'town', mapsUrl: null },
    areaId: 'town',
    startsAt: NOW + DAY,
    durationMins: 60,
    format: '5v5',
    capacity: 10,
    costPerPlayerPence: 500,
    notes: null,
    status: 'scheduled',
    confirmedCount: 0,
    waitlistCount: 0,
    reminderSentAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

export function makeParticipant(uid: string, state: ParticipantState = 'confirmed', joinedAt = NOW): Participant {
  return { uid, displayName: uid, gameStartsAt: NOW + DAY, state, joinedAt, paid: false, paidUpdatedAt: null };
}

/** n confirmed players c0..c(n-1), joined one ms apart. */
export function confirmedPlayers(n: number): Participant[] {
  return Array.from({ length: n }, (_, i) => makeParticipant(`c${i}`, 'confirmed', NOW + i));
}

export function expectDomainError(fn: () => unknown, code: DomainErrorCode): DomainError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe(code);
    return err as DomainError;
  }
  throw new Error(`Expected DomainError(${code}) but nothing was thrown`);
}
