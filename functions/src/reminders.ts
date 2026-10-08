import { gameFromData, gameLabel } from '@pw/shared';
import type { Firestore } from 'firebase-admin/firestore';
import type { Notice } from './lib/callable';
import { ts } from './lib/convert';

const HOUR = 3_600_000;
export const REMINDER_WINDOW = { fromMs: 23 * HOUR, toMs: 24 * HOUR };

export async function runReminders(db: Firestore, now: number): Promise<Notice[]> {
  const candidates = await db
    .collection('games')
    .where('status', '==', 'scheduled')
    .where('startsAt', '>=', ts(now + REMINDER_WINDOW.fromMs))
    .where('startsAt', '<=', ts(now + REMINDER_WINDOW.toMs))
    .get();

  const notices: Notice[] = [];
  for (const candidate of candidates.docs) {
    const claimed = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(candidate.ref);
      const game = gameFromData(fresh.id, fresh.data()!);
      if (game.status !== 'scheduled' || game.reminderSentAt !== null) return null;
      const confirmed = await tx.get(candidate.ref.collection('participants').where('state', '==', 'confirmed'));
      tx.update(candidate.ref, { reminderSentAt: ts(now) });
      return { game, uids: confirmed.docs.map((d) => d.id) };
    });
    if (!claimed) continue;
    const label = gameLabel(claimed.game);
    for (const uid of claimed.uids) {
      notices.push({ uid, event: { type: 'reminder', gameId: claimed.game.id, gameLabel: label } });
    }
  }
  return notices;
}
