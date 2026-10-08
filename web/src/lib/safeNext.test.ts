import { describe, expect, it } from 'vitest';
import { safeNext } from './safeNext';

describe('safeNext', () => {
  it('keeps in-app paths', () => {
    expect(safeNext('/games/abc')).toBe('/games/abc');
    expect(safeNext('/games/abc?x=1')).toBe('/games/abc?x=1');
  });

  it.each([null, '', 'https://evil.example.com', '//evil.example.com', '/\\evil.example.com', 'games/abc', '/sign-in'])(
    'falls back to home for %j',
    (value) => {
      expect(safeNext(value)).toBe('/');
    },
  );
});
