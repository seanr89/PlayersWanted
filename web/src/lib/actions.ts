import { hasStarted, isFull, type Game, type Participant } from '@pw/shared';

export type PrimaryAction =
  | { kind: 'sign-in' | 'join' | 'join-waitlist' | 'leave' | 'leave-waitlist'; label: string }
  | { kind: 'none'; label: string };

export function primaryAction(game: Game, me: Participant | undefined, signedIn: boolean, now: number): PrimaryAction {
  if (game.status === 'cancelled') return { kind: 'none', label: 'This game was cancelled' };
  if (me) return me.state === 'confirmed' ? { kind: 'leave', label: 'Leave game' } : { kind: 'leave-waitlist', label: 'Leave waitlist' };
  if (hasStarted(game, now)) return { kind: 'none', label: 'This game has started' };
  if (!signedIn) return { kind: 'sign-in', label: 'Sign in to join' };
  return isFull(game) ? { kind: 'join-waitlist', label: 'Join waitlist' } : { kind: 'join', label: 'Join game' };
}
