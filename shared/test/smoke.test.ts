import { describe, expect, it } from 'vitest';
import { APP_NAME } from '../src';

describe('shared package', () => {
  it('exports the app name', () => {
    expect(APP_NAME).toBe('PlayersWanted');
  });
});
