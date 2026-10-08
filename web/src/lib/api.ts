import type { GameInput, ParticipantState } from '@pw/shared';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

function call<I, O>(name: string) {
  const fn = httpsCallable<I, O>(functions, name);
  return async (input: I): Promise<O> => (await fn(input)).data;
}

type GameRef = { gameId: string };

export const api = {
  createGame: call<GameInput, { gameId: string }>('createGame'),
  updateGame: call<GameInput & GameRef, { ok: true }>('updateGame'),
  cancelGame: call<GameRef, { ok: true }>('cancelGame'),
  joinGame: call<GameRef, { state: ParticipantState }>('joinGame'),
  leaveGame: call<GameRef, { ok: true }>('leaveGame'),
  removePlayer: call<GameRef & { uid: string }, { ok: true }>('removePlayer'),
  setPaid: call<GameRef & { uid: string; paid: boolean }, { ok: true }>('setPaid'),
};
