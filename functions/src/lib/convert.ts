import type { Game, Participant } from '@pw/shared';
import { Timestamp } from 'firebase-admin/firestore';

export function ts(ms: number): Timestamp;
export function ts(ms: number | null): Timestamp | null;
export function ts(ms: number | null): Timestamp | null {
  return ms === null ? null : Timestamp.fromMillis(ms);
}

export function gameToData(game: Omit<Game, 'id'>): Record<string, unknown> {
  return {
    ...game,
    startsAt: ts(game.startsAt),
    reminderSentAt: ts(game.reminderSentAt),
    createdAt: ts(game.createdAt),
    updatedAt: ts(game.updatedAt),
  };
}

export function participantToData(p: Participant): Record<string, unknown> {
  return {
    ...p,
    gameStartsAt: ts(p.gameStartsAt),
    joinedAt: ts(p.joinedAt),
    paidUpdatedAt: ts(p.paidUpdatedAt),
  };
}
