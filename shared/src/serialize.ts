import type { Game, Participant, UserProfile, Venue } from './types';

export interface TimestampLike {
  toMillis(): number;
}

type Data = Record<string, unknown>;

export function toMillis(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && typeof (value as TimestampLike).toMillis === 'function') {
    return (value as TimestampLike).toMillis();
  }
  throw new Error(`Not a timestamp: ${String(value)}`);
}

function requiredMillis(value: unknown, field: string): number {
  const ms = toMillis(value);
  if (ms === null) throw new Error(`Missing timestamp field ${field}`);
  return ms;
}

export function gameFromData(id: string, d: Data): Game {
  const venue = (d.venue ?? {}) as Data;
  return {
    id,
    organiserUid: d.organiserUid as string,
    organiserName: d.organiserName as string,
    venueId: d.venueId as string,
    venue: {
      name: venue.name as string,
      address: venue.address as string,
      areaId: venue.areaId as string,
      mapsUrl: (venue.mapsUrl as string | undefined) ?? null,
    },
    areaId: d.areaId as string,
    startsAt: requiredMillis(d.startsAt, 'startsAt'),
    durationMins: d.durationMins as number,
    format: d.format as Game['format'],
    capacity: d.capacity as number,
    costPerPlayerPence: d.costPerPlayerPence as number,
    notes: (d.notes as string | undefined) ?? null,
    status: d.status as Game['status'],
    confirmedCount: (d.confirmedCount as number | undefined) ?? 0,
    waitlistCount: (d.waitlistCount as number | undefined) ?? 0,
    reminderSentAt: toMillis(d.reminderSentAt),
    createdAt: requiredMillis(d.createdAt, 'createdAt'),
    updatedAt: requiredMillis(d.updatedAt, 'updatedAt'),
  };
}

export function participantFromData(d: Data): Participant {
  return {
    uid: d.uid as string,
    displayName: d.displayName as string,
    gameStartsAt: requiredMillis(d.gameStartsAt, 'gameStartsAt'),
    state: d.state as Participant['state'],
    joinedAt: requiredMillis(d.joinedAt, 'joinedAt'),
    paid: (d.paid as boolean | undefined) ?? false,
    paidUpdatedAt: toMillis(d.paidUpdatedAt),
  };
}

export function profileFromData(d: Data): UserProfile {
  const notify = (d.notify ?? {}) as Data;
  return {
    displayName: d.displayName as string,
    email: (d.email as string | undefined) ?? null,
    photoURL: (d.photoURL as string | undefined) ?? null,
    homeAreaId: d.homeAreaId as string,
    notify: {
      email: (notify.email as boolean | undefined) ?? true,
      push: (notify.push as boolean | undefined) ?? false,
    },
  };
}

export function venueFromData(id: string, d: Data): Venue {
  return {
    id,
    name: d.name as string,
    areaId: d.areaId as string,
    address: d.address as string,
    mapsUrl: (d.mapsUrl as string | undefined) ?? null,
    createdBy: d.createdBy as string,
  };
}
