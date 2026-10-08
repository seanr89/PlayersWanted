import type { Game, Participant } from '@pw/shared';
import { describe, expect, it } from 'vitest';
import { primaryAction } from './actions';

const NOW = Date.UTC(2026, 9, 1, 12);
const game = (over: Partial<Game> = {}): Game => ({
  id: 'g1',
  organiserUid: 'org',
  organiserName: 'Org',
  venueId: 'v1',
  venue: { name: 'Leisure Centre', address: '1 High St', areaId: 'town', mapsUrl: null },
  areaId: 'town',
  startsAt: NOW + 3_600_000,
  durationMins: 60,
  format: '5v5',
  capacity: 10,
  costPerPlayerPence: 500,
  notes: null,
  status: 'scheduled',
  confirmedCount: 3,
  waitlistCount: 0,
  reminderSentAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});
const me = (state: Participant['state']): Participant => ({
  uid: 'me',
  displayName: 'Me',
  gameStartsAt: NOW,
  state,
  joinedAt: NOW,
  paid: false,
  paidUpdatedAt: null,
});

describe('primaryAction', () => {
  it('asks anonymous visitors to sign in', () => {
    expect(primaryAction(game(), undefined, false, NOW).kind).toBe('sign-in');
  });
  it('offers join when there is space', () => {
    expect(primaryAction(game(), undefined, true, NOW)).toEqual({ kind: 'join', label: 'Join game' });
  });
  it('offers the waitlist when full', () => {
    expect(primaryAction(game({ confirmedCount: 10 }), undefined, true, NOW).kind).toBe('join-waitlist');
  });
  it('offers leave to participants', () => {
    expect(primaryAction(game(), me('confirmed'), true, NOW).kind).toBe('leave');
    expect(primaryAction(game(), me('waitlisted'), true, NOW).kind).toBe('leave-waitlist');
  });
  it('offers no leave to participants once the game has started', () => {
    expect(primaryAction(game({ startsAt: NOW }), me('confirmed'), true, NOW)).toEqual({
      kind: 'none',
      label: 'This game has started',
    });
    expect(primaryAction(game({ startsAt: NOW }), me('waitlisted'), true, NOW).kind).toBe('none');
  });
  it('offers nothing on cancelled or started games to non-participants', () => {
    expect(primaryAction(game({ status: 'cancelled' }), me('confirmed'), true, NOW).kind).toBe('none');
    expect(primaryAction(game({ startsAt: NOW }), undefined, true, NOW).kind).toBe('none');
  });
});
