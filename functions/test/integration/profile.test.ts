import { beforeEach, describe, expect, it } from 'vitest';
import { requireProfile } from '../../src/lib/profile';
import { clearFirestore, db, seedArea, seedUser } from './helpers';

describe('requireProfile', () => {
  beforeEach(async () => {
    await clearFirestore();
    await seedArea();
  });

  it('returns the profile', async () => {
    await seedUser('alice', 'Alice');
    const profile = await requireProfile(db, 'alice');
    expect(profile.displayName).toBe('Alice');
    expect(profile.notify).toEqual({ email: true, push: false });
  });

  it('rejects a user who has not finished onboarding', async () => {
    await expect(requireProfile(db, 'ghost')).rejects.toMatchObject({ code: 'failed-precondition' });
  });
});
