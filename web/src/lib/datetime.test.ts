import { describe, expect, it } from 'vitest';
import { fromLocalInput, toLocalInput } from './datetime';

describe('datetime-local conversion (device in Europe/London)', () => {
  it('round-trips a summer time', () => {
    const ms = Date.UTC(2026, 6, 4, 18, 0);
    expect(toLocalInput(ms)).toBe('2026-07-04T19:00');
    expect(fromLocalInput('2026-07-04T19:00')).toBe(ms);
  });

  it('round-trips a winter time', () => {
    const ms = Date.UTC(2026, 10, 7, 19, 0);
    expect(toLocalInput(ms)).toBe('2026-11-07T19:00');
    expect(fromLocalInput('2026-11-07T19:00')).toBe(ms);
  });

  it('returns null for empty or invalid input', () => {
    expect(fromLocalInput('')).toBeNull();
    expect(fromLocalInput('not a date')).toBeNull();
  });
});
