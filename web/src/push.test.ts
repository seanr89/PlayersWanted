import { describe, expect, it } from 'vitest';
import { shouldPromptForPush } from './push';

describe('shouldPromptForPush', () => {
  it('prompts only for installed apps that have not decided yet', () => {
    expect(shouldPromptForPush({ standalone: true, permission: 'default', pushOn: false })).toBe(true);
  });

  it.each([
    { standalone: false, permission: 'default', pushOn: false },
    { standalone: true, permission: 'denied', pushOn: false },
    { standalone: true, permission: 'granted', pushOn: true },
    { standalone: true, permission: 'unsupported', pushOn: false },
  ] as const)('does not prompt for %j', (env) => {
    expect(shouldPromptForPush(env)).toBe(false);
  });
});
