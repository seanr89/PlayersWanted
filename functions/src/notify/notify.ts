import type { Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { db as defaultDb } from '../lib/admin';
import { setDispatcher, type Notice } from '../lib/callable';
import { APP_URL, isEmulator } from '../lib/config';
import { liveChannels, outboxChannels, type Channels } from './channels';
import { renderNotification } from './templates';

export interface NotifyDeps {
  db: Firestore;
  channels: Channels;
  appUrl: string;
}

function defaultDeps(): NotifyDeps {
  return {
    db: defaultDb,
    channels: isEmulator() ? outboxChannels(defaultDb) : liveChannels,
    appUrl: APP_URL.value(),
  };
}

export async function notify(notice: Notice, deps: NotifyDeps): Promise<void> {
  const userSnap = await deps.db.doc(`users/${notice.uid}`).get();
  if (!userSnap.exists) return;
  const user = userSnap.data()!;
  const wantsEmail = user.notify?.email ?? true;
  const wantsPush = user.notify?.push ?? false;
  const msg = renderNotification(notice.event, deps.appUrl);

  const tasks: Promise<unknown>[] = [];
  if (wantsEmail && typeof user.email === 'string') {
    tasks.push(deps.channels.email(notice.uid, user.email, msg));
  }
  if (wantsPush) {
    const tokens = await deps.db.collection(`users/${notice.uid}/pushTokens`).get();
    for (const tokenDoc of tokens.docs) {
      tasks.push(
        deps.channels.push(notice.uid, tokenDoc.id, msg).then(async (outcome) => {
          if (outcome === 'invalid-token') await tokenDoc.ref.delete();
        }),
      );
    }
  }

  const results = await Promise.allSettled(tasks);
  for (const r of results) {
    if (r.status === 'rejected') {
      logger.error('Notification channel failed', { uid: notice.uid, type: notice.event.type, error: String(r.reason) });
    }
  }
}

export async function dispatchNotices(notices: Notice[], deps: NotifyDeps = defaultDeps()): Promise<void> {
  await Promise.all(
    notices.map((n) =>
      notify(n, deps).catch((err) => logger.error('Notification failed', { uid: n.uid, type: n.event.type, error: String(err) })),
    ),
  );
}

export function installDispatcher(): void {
  setDispatcher((notices) => dispatchNotices(notices));
}
