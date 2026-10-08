import { DomainError } from './errors';
import type { Game, Participant } from './types';

export interface Joiner {
  uid: string;
  displayName: string;
}

export interface RosterPlan {
  noop: boolean;
  add: Participant | null;
  removed: Participant | null;
  promoteUids: string[];
  confirmedCount: number;
  waitlistCount: number;
}

export interface JoinOptions {
  allowStarted?: boolean;
}

export function countStates(participants: Participant[]): { confirmed: number; waitlisted: number } {
  let confirmed = 0;
  let waitlisted = 0;
  for (const p of participants) {
    if (p.state === 'confirmed') confirmed++;
    else waitlisted++;
  }
  return { confirmed, waitlisted };
}

export function sortWaitlist(participants: Participant[]): Participant[] {
  return participants
    .filter((p) => p.state === 'waitlisted')
    .sort((a, b) => a.joinedAt - b.joinedAt || a.uid.localeCompare(b.uid));
}

/** Promotes the earliest waitlisted players into any free confirmed places. */
export function fillFromWaitlist(
  participants: Participant[],
  capacity: number,
): Pick<RosterPlan, 'promoteUids' | 'confirmedCount' | 'waitlistCount'> {
  const { confirmed, waitlisted } = countStates(participants);
  const free = Math.max(0, capacity - confirmed);
  const promoteUids = sortWaitlist(participants)
    .slice(0, free)
    .map((p) => p.uid);
  return {
    promoteUids,
    confirmedCount: confirmed + promoteUids.length,
    waitlistCount: waitlisted - promoteUids.length,
  };
}

export function planJoin(
  game: Game,
  participants: Participant[],
  joiner: Joiner,
  now: number,
  opts: JoinOptions = {},
): RosterPlan {
  if (game.status === 'cancelled') throw new DomainError('failed-precondition', 'This game has been cancelled.');
  if (!opts.allowStarted && now >= game.startsAt) {
    throw new DomainError('failed-precondition', 'This game has already started.');
  }

  const { confirmed, waitlisted } = countStates(participants);
  if (participants.some((p) => p.uid === joiner.uid)) {
    return { noop: true, add: null, removed: null, promoteUids: [], confirmedCount: confirmed, waitlistCount: waitlisted };
  }

  const state = confirmed < game.capacity ? 'confirmed' : 'waitlisted';
  const add: Participant = {
    uid: joiner.uid,
    displayName: joiner.displayName,
    gameStartsAt: game.startsAt,
    state,
    joinedAt: now,
    paid: false,
    paidUpdatedAt: null,
  };
  return {
    noop: false,
    add,
    removed: null,
    promoteUids: [],
    confirmedCount: confirmed + (state === 'confirmed' ? 1 : 0),
    waitlistCount: waitlisted + (state === 'waitlisted' ? 1 : 0),
  };
}
