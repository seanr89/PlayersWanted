import {
  DomainError,
  gameFromData,
  participantFromData,
  type Game,
  type Participant,
  type RosterPlan,
  type VenueSnapshot,
} from '@pw/shared';
import type { DocumentData, DocumentReference, Firestore, Transaction } from 'firebase-admin/firestore';
import { participantToData, ts } from './convert';

export async function loadGameTx(
  tx: Transaction,
  db: Firestore,
  gameId: string,
): Promise<{ ref: DocumentReference; game: Game; participants: Participant[] }> {
  const ref = db.doc(`games/${gameId}`);
  const snap = await tx.get(ref);
  if (!snap.exists) throw new DomainError('not-found', 'That game no longer exists.');
  const roster = await tx.get(ref.collection('participants'));
  return {
    ref,
    game: gameFromData(snap.id, snap.data()!),
    participants: roster.docs.map((d) => participantFromData(d.data())),
  };
}

export function assertOrganiser(game: Game, uid: string): void {
  if (game.organiserUid !== uid) throw new DomainError('permission-denied', 'Only the organiser can do that.');
}

/** Rejects changes to games that are closed. M4 adds the "completed" branch. */
export function assertOpen(game: Game): void {
  if (game.status === 'cancelled') throw new DomainError('failed-precondition', 'This game has been cancelled.');
}

export function venueSnapshot(d: DocumentData): VenueSnapshot {
  return { name: d.name, address: d.address, areaId: d.areaId, mapsUrl: d.mapsUrl ?? null };
}

export interface ApplyOptions {
  /** Extra fields merged into the single game update. */
  gameFields?: Record<string, unknown>;
  /** Fields written to every participant that stays on the roster. */
  allParticipantFields?: Record<string, unknown>;
}

/** Writes a RosterPlan with at most one write per document. */
export function applyRosterPlan(
  tx: Transaction,
  ref: DocumentReference,
  participants: Participant[],
  plan: RosterPlan,
  now: number,
  opts: ApplyOptions = {},
): void {
  const roster = ref.collection('participants');
  const promote = new Set(plan.promoteUids);
  const all = opts.allParticipantFields ?? {};

  for (const p of participants) {
    if (plan.removed?.uid === p.uid) {
      tx.delete(roster.doc(p.uid));
      continue;
    }
    const fields: Record<string, unknown> = { ...all };
    if (promote.has(p.uid)) fields.state = 'confirmed';
    if (Object.keys(fields).length > 0) tx.update(roster.doc(p.uid), fields);
  }
  if (plan.add) tx.set(roster.doc(plan.add.uid), participantToData(plan.add));

  const gameFields = opts.gameFields ?? {};
  if (plan.noop && Object.keys(gameFields).length === 0) return;
  tx.update(ref, {
    confirmedCount: plan.confirmedCount,
    waitlistCount: plan.waitlistCount,
    updatedAt: ts(now),
    ...gameFields,
  });
}
