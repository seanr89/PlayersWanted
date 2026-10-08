import type { NotificationEvent } from '@pw/shared';
import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from './admin';
import { REGION, RESEND_API_KEY } from './config';
import { toHttpsError } from './errors';

export interface CallContext {
  uid: string;
  isAdmin: boolean;
  db: Firestore;
  now: number;
}

export interface Notice {
  uid: string;
  event: NotificationEvent;
}

export interface HandlerResult<T> {
  data: T;
  notices: Notice[];
}

export type Handler<T> = (ctx: CallContext, input: unknown) => Promise<HandlerResult<T>>;

type Dispatcher = (notices: Notice[]) => Promise<void>;
let dispatch: Dispatcher = async () => {};

/** Task 8 registers the real dispatcher; kept injectable so this module has no notify import cycle. */
export function setDispatcher(fn: Dispatcher): void {
  dispatch = fn;
}

export function callable<T>(handler: Handler<T>) {
  return onCall({ region: REGION, secrets: [RESEND_API_KEY] }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Please sign in first.');
    const ctx: CallContext = {
      uid: request.auth.uid,
      isAdmin: request.auth.token.admin === true,
      db,
      now: Date.now(),
    };
    let result: HandlerResult<T>;
    try {
      result = await handler(ctx, request.data);
    } catch (err) {
      throw toHttpsError(err);
    }
    await dispatch(result.notices);
    return result.data;
  });
}
