import { describe, expect, it } from 'vitest';
import { formatKickoff, formatPence, gameLabel, hasStarted, isFull, parsePounds, spacesLabel } from '../src/format';
import { makeGame, NOW } from './fixtures';

describe('formatPence', () => {
  it.each([
    [0, 'Free'],
    [500, '£5'],
    [550, '£5.50'],
    [1234, '£12.34'],
    [5, '£0.05'],
  ])('%i → %s', (pence, text) => {
    expect(formatPence(pence)).toBe(text);
  });
});

describe('parsePounds', () => {
  it.each([
    ['5', 500],
    ['5.5', 550],
    ['£5.50', 550],
    [' 12.34 ', 1234],
    ['0', 0],
    ['', 0],
  ])('%j → %i', (text, pence) => {
    expect(parsePounds(text)).toBe(pence);
  });

  it.each(['abc', '5.555', '-1', '1,50'])('rejects %j', (text) => {
    expect(parsePounds(text)).toBeNull();
  });
});

describe('formatKickoff', () => {
  it('shows London summer time (BST) for a July game', () => {
    expect(formatKickoff(Date.UTC(2026, 6, 4, 18, 0))).toBe('Sat 4 Jul, 19:00');
  });

  it('shows GMT for a November game', () => {
    expect(formatKickoff(Date.UTC(2026, 10, 7, 19, 0))).toBe('Sat 7 Nov, 19:00');
  });

  it('shows midnight as 00:00', () => {
    expect(formatKickoff(Date.UTC(2026, 10, 7, 0, 0))).toBe('Sat 7 Nov, 00:00');
  });
});

describe('gameLabel', () => {
  it('combines venue and kick-off', () => {
    const game = makeGame({ startsAt: Date.UTC(2026, 10, 7, 19, 0) });
    expect(gameLabel(game)).toBe('Leisure Centre, Sat 7 Nov, 19:00');
  });
});

describe('spaces', () => {
  it('counts spaces left', () => {
    expect(spacesLabel(makeGame({ capacity: 10, confirmedCount: 7 }))).toBe('3 spaces left');
    expect(spacesLabel(makeGame({ capacity: 10, confirmedCount: 9 }))).toBe('1 space left');
  });

  it('shows full with and without a waitlist', () => {
    expect(spacesLabel(makeGame({ capacity: 10, confirmedCount: 10 }))).toBe('Full');
    expect(spacesLabel(makeGame({ capacity: 10, confirmedCount: 10, waitlistCount: 2 }))).toBe('Full · 2 waiting');
  });

  it('derives full and started', () => {
    expect(isFull(makeGame({ capacity: 10, confirmedCount: 10 }))).toBe(true);
    expect(isFull(makeGame({ capacity: 10, confirmedCount: 9 }))).toBe(false);
    expect(hasStarted(makeGame({ startsAt: NOW }), NOW)).toBe(true);
    expect(hasStarted(makeGame({ startsAt: NOW + 1 }), NOW)).toBe(false);
  });
});
