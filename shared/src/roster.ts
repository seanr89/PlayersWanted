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

export interface PlanLeaveOptions {
  /** Fill the freed place from the waitlist. Off once the game has started. Default true. */
  promote?: boolean;
}

export function planLeave(game: Game, participants: Participant[], uid: string, opts: PlanLeaveOptions = {}): RosterPlan {
  const leaving = participants.find((p) => p.uid === uid);
  if (!leaving) {
    const { confirmed, waitlisted } = countStates(participants);
    return { noop: true, add: null, removed: null, promoteUids: [], confirmedCount: confirmed, waitlistCount: waitlisted };
  }
  const remaining = participants.filter((p) => p.uid !== uid);
  if (opts.promote === false) {
    const { confirmed, waitlisted } = countStates(remaining);
    return { noop: false, add: null, removed: leaving, promoteUids: [], confirmedCount: confirmed, waitlistCount: waitlisted };
  }
  return { noop: false, add: null, removed: leaving, ...fillFromWaitlist(remaining, game.capacity) };
}

export function planCapacityChange(game: Game, participants: Participant[], newCapacity: number): RosterPlan {
  const { confirmed } = countStates(participants);
  if (newCapacity < confirmed) {
    throw new DomainError(
      'failed-precondition',
      `Capacity can't be lower than the ${confirmed} confirmed players. Remove players first.`,
    );
  }
  return {
    noop: newCapacity === game.capacity,
    add: null,
    removed: null,
    ...fillFromWaitlist(participants, newCapacity),
  };
}
