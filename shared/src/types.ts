export const FORMATS = ['5v5', '6v6', '7v7'] as const;
export type Format = (typeof FORMATS)[number];

export type GameStatus = 'scheduled' | 'cancelled';
export type ParticipantState = 'confirmed' | 'waitlisted';

export interface VenueSnapshot {
  name: string;
  address: string;
  areaId: string;
  mapsUrl: string | null;
}

export interface Game {
  id: string;
  organiserUid: string;
  organiserName: string;
  venueId: string;
  venue: VenueSnapshot;
  areaId: string;
  startsAt: number;
  durationMins: number;
  format: Format;
  capacity: number;
  costPerPlayerPence: number;
  notes: string | null;
  status: GameStatus;
  confirmedCount: number;
  waitlistCount: number;
  reminderSentAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface Participant {
  uid: string;
  displayName: string;
  gameStartsAt: number;
  state: ParticipantState;
  joinedAt: number;
  paid: boolean;
  paidUpdatedAt: number | null;
}

export interface GameInput {
  venueId: string;
  startsAt: number;
  durationMins: number;
  format: Format;
  capacity: number;
  costPerPlayerPence: number;
  notes: string | null;
}

export interface NotifyPrefs {
  email: boolean;
  push: boolean;
}

export interface UserProfile {
  displayName: string;
  email: string | null;
  photoURL: string | null;
  homeAreaId: string;
  notify: NotifyPrefs;
}

export interface Area {
  id: string;
  name: string;
  order: number;
}

export interface Venue {
  id: string;
  name: string;
  areaId: string;
  address: string;
  mapsUrl: string | null;
  createdBy: string;
}
