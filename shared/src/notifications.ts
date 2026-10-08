import type { ParticipantState } from './types';

interface Base {
  gameId: string;
  gameLabel: string;
}

export type NotificationEvent =
  | (Base & { type: 'player_joined'; playerName: string; state: ParticipantState })
  | (Base & { type: 'player_left'; playerName: string })
  | (Base & { type: 'promoted' })
  | (Base & { type: 'removed' })
  | (Base & { type: 'game_changed' })
  | (Base & { type: 'game_cancelled' })
  | (Base & { type: 'reminder' });
