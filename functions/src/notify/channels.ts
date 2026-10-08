import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { logger } from 'firebase-functions/v2';
import { APP_URL, EMAIL_FROM, RESEND_API_KEY } from '../lib/config';
import type { Message } from './templates';

export interface Channels {
  email(uid: string, to: string, msg: Message): Promise<void>;
  push(uid: string, token: string, msg: Message): Promise<'ok' | 'invalid-token'>;
}

const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

export const liveChannels: Channels = {
  async email(_uid, to, msg) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY.value()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: EMAIL_FROM.value(),
        to: [to],
        subject: msg.title,
        text: `${msg.body}\n\nOpen the game: ${msg.url}\n\nChange your notification settings: ${APP_URL.value()}/profile`,
      }),
    });
    if (!res.ok) throw new Error(`Resend responded ${res.status}: ${await res.text()}`);
  },
  async push(_uid, token, msg) {
    try {
      // Data-only message: the service worker renders it (consistent on Android, desktop and iOS PWAs).
      await getMessaging().send({ token, data: { title: msg.title, body: msg.body, url: msg.url } });
      return 'ok';
    } catch (err) {
      const code = (err as { code?: string }).code ?? '';
      if (INVALID_TOKEN_CODES.has(code)) return 'invalid-token';
      throw err;
    }
  },
};

/** Emulator stand-in: logs and records every message in devOutbox so tests and developers can inspect it. */
export function outboxChannels(db: Firestore): Channels {
  return {
    async email(uid, to, msg) {
      logger.info('[email stub]', { to, ...msg });
      await db.collection('devOutbox').add({ channel: 'email', uid, to, ...msg, at: FieldValue.serverTimestamp() });
    },
    async push(uid, token, msg) {
      const invalid = token.startsWith('invalid-');
      logger.info('[push stub]', { token, invalid, ...msg });
      await db
        .collection('devOutbox')
        .add({ channel: 'push', uid, token, invalid, ...msg, at: FieldValue.serverTimestamp() });
      return invalid ? 'invalid-token' : 'ok';
    },
  };
}
