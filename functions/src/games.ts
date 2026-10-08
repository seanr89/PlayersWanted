import {
  DomainError,
  gameLabel,
  hasStarted,
  planCapacityChange,
  requireId,
  validateGameInput,
  type Game,
} from '@pw/shared';
import type { Firestore } from 'firebase-admin/firestore';
import type { CallContext, HandlerResult, Notice } from './lib/callable';
import { gameToData, ts } from './lib/convert';
import { applyRosterPlan, assertOpen, assertOrganiser, loadGameTx, venueSnapshot } from './lib/games-tx';
import { requireProfile } from './lib/profile';

export async function createGameHandler(ctx: CallContext, raw: unknown): Promise<HandlerResult<{ gameId: string }>> {
  const input = validateGameInput(raw, ctx.now);
  const profile = await requireProfile(ctx.db, ctx.uid);
  const venueSnap = await ctx.db.doc(`venues/${input.venueId}`).get();
  if (!venueSnap.exists) throw new DomainError('not-found', 'That venue no longer exists.');
  const venue = venueSnapshot(venueSnap.data()!);

  const ref = ctx.db.collection('games').doc();
  const game: Omit<Game, 'id'> = {
    organiserUid: ctx.uid,
    organiserName: profile.displayName,
    venueId: input.venueId,
    venue,
    areaId: venue.areaId,
    startsAt: input.startsAt,
    durationMins: input.durationMins,
    format: input.format,
    capacity: input.capacity,
    costPerPlayerPence: input.costPerPlayerPence,
    notes: input.notes,
    status: 'scheduled',
    confirmedCount: 0,
    waitlistCount: 0,
    reminderSentAt: null,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };
  await ref.set(gameToData(game));
  return { data: { gameId: ref.id }, notices: [] };
}

export async function updateGameHandler(ctx: CallContext, raw: unknown): Promise<HandlerResult<{ ok: true }>> {
  const gameId = requireId(raw, 'gameId');
  return ctx.db.runTransaction(async (tx) => {
    const { ref, game, participants } = await loadGameTx(tx, ctx.db, gameId);
    assertOrganiser(game, ctx.uid);
    assertOpen(game);
    const input = validateGameInput(raw, ctx.now, { existingStartsAt: game.startsAt });

    const venueChanged = input.venueId !== game.venueId;
    let venue = game.venue;
    if (venueChanged) {
      const venueSnap = await tx.get(ctx.db.doc(`venues/${input.venueId}`));
      if (!venueSnap.exists) throw new DomainError('not-found', 'That venue no longer exists.');
      venue = venueSnapshot(venueSnap.data()!);
    }
    const timeChanged = input.startsAt !== game.startsAt;
    if (input.capacity !== game.capacity && hasStarted(game, ctx.now)) {
      throw new DomainError('failed-precondition', "Capacity can't change after kick-off.");
    }
    const plan = planCapacityChange(game, participants, input.capacity);

    applyRosterPlan(tx, ref, participants, plan, ctx.now, {
      gameFields: {
        venueId: input.venueId,
        venue,
        areaId: venue.areaId,
        startsAt: ts(input.startsAt),
        durationMins: input.durationMins,
        format: input.format,
        capacity: input.capacity,
        costPerPlayerPence: input.costPerPlayerPence,
        notes: input.notes,
        ...(timeChanged ? { reminderSentAt: null } : {}),
      },
      allParticipantFields: timeChanged ? { gameStartsAt: ts(input.startsAt) } : {},
    });

    const label = gameLabel({ venue, startsAt: input.startsAt });
    const notices: Notice[] = [];
    if (timeChanged || venueChanged) {
      for (const p of participants) notices.push({ uid: p.uid, event: { type: 'game_changed', gameId, gameLabel: label } });
    }
    for (const uid of plan.promoteUids) notices.push({ uid, event: { type: 'promoted', gameId, gameLabel: label } });
    return { data: { ok: true as const }, notices };
  });
}

/** Cancels a game; returns the notices to send. Idempotent. */
export async function cancelGameTx(
  db: Firestore,
  gameId: string,
  now: number,
  authorise: (game: Game) => void,
): Promise<Notice[]> {
  return db.runTransaction(async (tx) => {
    const { ref, game, participants } = await loadGameTx(tx, db, gameId);
    authorise(game);
    if (game.status === 'cancelled') return [];
    assertOpen(game);
    tx.update(ref, { status: 'cancelled', updatedAt: ts(now) });
    const label = gameLabel(game);
    return participants.map((p) => ({ uid: p.uid, event: { type: 'game_cancelled' as const, gameId, gameLabel: label } }));
  });
}

export async function cancelGameHandler(ctx: CallContext, raw: unknown): Promise<HandlerResult<{ ok: true }>> {
  const gameId = requireId(raw, 'gameId');
  const notices = await cancelGameTx(ctx.db, gameId, ctx.now, (game) => assertOrganiser(game, ctx.uid));
  return { data: { ok: true }, notices };
}
