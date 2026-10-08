import {
  DomainError,
  gameFromData,
  gameLabel,
  isRecord,
  planJoin,
  planLeave,
  requireId,
  type Game,
  type ParticipantState,
} from '@pw/shared';
import type { Firestore } from 'firebase-admin/firestore';
import type { CallContext, HandlerResult, Notice } from './lib/callable';
import { ts } from './lib/convert';
import { applyRosterPlan, assertOpen, assertOrganiser, loadGameTx } from './lib/games-tx';
import { requireProfile } from './lib/profile';

export async function joinGameHandler(
  ctx: CallContext,
  raw: unknown,
): Promise<HandlerResult<{ state: ParticipantState }>> {
  const gameId = requireId(raw, 'gameId');
  const profile = await requireProfile(ctx.db, ctx.uid);
  return ctx.db.runTransaction(async (tx) => {
    const { ref, game, participants } = await loadGameTx(tx, ctx.db, gameId);
    const plan = planJoin(game, participants, { uid: ctx.uid, displayName: profile.displayName }, ctx.now);
    if (plan.noop) {
      const me = participants.find((p) => p.uid === ctx.uid)!;
      return { data: { state: me.state }, notices: [] };
    }
    applyRosterPlan(tx, ref, participants, plan, ctx.now);
    const state = plan.add!.state;
    const notices: Notice[] =
      game.organiserUid === ctx.uid
        ? []
        : [
            {
              uid: game.organiserUid,
              event: { type: 'player_joined', gameId, gameLabel: gameLabel(game), playerName: profile.displayName, state },
            },
          ];
    return { data: { state }, notices };
  });
}

export interface LeaveOptions {
  gameId: string;
  uid: string;
  now: number;
  mode: 'left' | 'removed';
  authorise: (game: Game) => void;
}

/** Removes a player and promotes from the waitlist. Returns the notices to send. */
export async function performLeave(db: Firestore, opts: LeaveOptions): Promise<Notice[]> {
  const { gameId, uid, now, mode } = opts;
  return db.runTransaction(async (tx) => {
    const { ref, game, participants } = await loadGameTx(tx, db, gameId);
    opts.authorise(game);
    assertOpen(game);
    const plan = planLeave(game, participants, uid);
    if (plan.noop) return [];
    applyRosterPlan(tx, ref, participants, plan, now);

    const label = gameLabel(game);
    const notices: Notice[] = [];
    if (mode === 'left' && game.organiserUid !== uid) {
      notices.push({
        uid: game.organiserUid,
        event: { type: 'player_left', gameId, gameLabel: label, playerName: plan.removed!.displayName },
      });
    }
    if (mode === 'removed') notices.push({ uid, event: { type: 'removed', gameId, gameLabel: label } });
    for (const promoted of plan.promoteUids) {
      notices.push({ uid: promoted, event: { type: 'promoted', gameId, gameLabel: label } });
    }
    return notices;
  });
}

export async function leaveGameHandler(ctx: CallContext, raw: unknown): Promise<HandlerResult<{ ok: true }>> {
  const gameId = requireId(raw, 'gameId');
  const notices = await performLeave(ctx.db, { gameId, uid: ctx.uid, now: ctx.now, mode: 'left', authorise: () => {} });
  return { data: { ok: true }, notices };
}

export async function removePlayerHandler(ctx: CallContext, raw: unknown): Promise<HandlerResult<{ ok: true }>> {
  const gameId = requireId(raw, 'gameId');
  const uid = requireId(raw, 'uid');
  const notices = await performLeave(ctx.db, {
    gameId,
    uid,
    now: ctx.now,
    mode: 'removed',
    authorise: (game) => assertOrganiser(game, ctx.uid),
  });
  return { data: { ok: true }, notices };
}

export async function setPaidHandler(ctx: CallContext, raw: unknown): Promise<HandlerResult<{ ok: true }>> {
  const gameId = requireId(raw, 'gameId');
  const uid = requireId(raw, 'uid');
  const paid = isRecord(raw) ? raw.paid : undefined;
  if (typeof paid !== 'boolean') throw new DomainError('invalid-argument', 'paid must be true or false.');

  await ctx.db.runTransaction(async (tx) => {
    const gameRef = ctx.db.doc(`games/${gameId}`);
    const gameSnap = await tx.get(gameRef);
    if (!gameSnap.exists) throw new DomainError('not-found', 'That game no longer exists.');
    assertOrganiser(gameFromData(gameSnap.id, gameSnap.data()!), ctx.uid);
    const pRef = gameRef.collection('participants').doc(uid);
    const pSnap = await tx.get(pRef);
    if (!pSnap.exists) throw new DomainError('not-found', 'That player is not on this game.');
    if (pSnap.data()!.state !== 'confirmed') {
      throw new DomainError('failed-precondition', 'Only confirmed players can be marked as paid.');
    }
    tx.update(pRef, { paid, paidUpdatedAt: ts(ctx.now) });
  });
  return { data: { ok: true }, notices: [] };
}
