import type { Notice } from '../../src/lib/callable';
import { outboxChannels, type Channels } from '../../src/notify/channels';
import { dispatchNotices, notify, type NotifyDeps } from '../../src/notify/notify';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearFirestore, db, seedArea, seedUser } from './helpers';

const deps = (): NotifyDeps => ({ db, channels: outboxChannels(db), appUrl: 'https://pw.example.com' });
const notice = (uid: string): Notice => ({
  uid,
  event: { type: 'promoted', gameId: 'g1', gameLabel: 'Leisure Centre, Sat 7 Nov, 19:00' },
});
const outbox = async () => (await db.collection('devOutbox').get()).docs.map((d) => d.data());

describe('notify', () => {
  beforeEach(async () => {
    await clearFirestore();
    await seedArea();
  });

  it('sends email only by default', async () => {
    await seedUser('alice');
    await notify(notice('alice'), deps());
    const sent = await outbox();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ channel: 'email', to: 'alice@example.com', title: "You're in! A space opened up" });
  });

  it('sends push to every token and deletes invalid tokens', async () => {
    await seedUser('bob', 'Bob', { notify: { email: false, push: true } });
    await db.doc('users/bob/pushTokens/good-token').set({ createdAt: new Date(), userAgent: 'x' });
    await db.doc('users/bob/pushTokens/invalid-token').set({ createdAt: new Date(), userAgent: 'x' });
    await notify(notice('bob'), deps());
    const sent = await outbox();
    expect(sent.filter((m) => m.channel === 'push')).toHaveLength(2);
    expect(sent.filter((m) => m.channel === 'email')).toHaveLength(0);
    expect((await db.doc('users/bob/pushTokens/invalid-token').get()).exists).toBe(false);
    expect((await db.doc('users/bob/pushTokens/good-token').get()).exists).toBe(true);
  });

  it('does nothing for a user with no profile', async () => {
    await notify(notice('ghost'), deps());
    expect(await outbox()).toHaveLength(0);
  });
});

describe('dispatchNotices', () => {
  beforeEach(async () => {
    await clearFirestore();
    await seedArea();
  });

  it('never throws when a channel fails', async () => {
    await seedUser('alice');
    const failing: Channels = {
      email: async () => {
        throw new Error('Resend is down');
      },
      push: async () => 'ok',
    };
    await expect(
      dispatchNotices([notice('alice')], { db, channels: failing, appUrl: 'https://pw.example.com' }),
    ).resolves.toBeUndefined();
  });
});
