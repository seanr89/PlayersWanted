import type { Game } from './types';

export const APP_TIME_ZONE = 'Europe/London';

export function formatPence(pence: number): string {
  if (pence === 0) return 'Free';
  if (pence % 100 === 0) return `£${pence / 100}`;
  return `£${(pence / 100).toFixed(2)}`;
}

/** Parses "5", "5.50", "£5.50" into pence. Empty input means free (0). Returns null if invalid. */
export function parsePounds(text: string): number | null {
  const cleaned = text.trim().replace(/^£/, '');
  if (cleaned === '') return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ''] = cleaned.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

const kickoffFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: APP_TIME_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** "Sat 7 Nov, 19:00" in London time, whatever the device or server timezone. */
export function formatKickoff(ms: number): string {
  const parts = Object.fromEntries(kickoffFormat.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return `${parts.weekday} ${parts.day} ${parts.month}, ${parts.hour}:${parts.minute}`;
}

export function gameLabel(game: Pick<Game, 'venue' | 'startsAt'>): string {
  return `${game.venue.name}, ${formatKickoff(game.startsAt)}`;
}

export function isFull(game: Pick<Game, 'capacity' | 'confirmedCount'>): boolean {
  return game.confirmedCount >= game.capacity;
}

export function hasStarted(game: Pick<Game, 'startsAt'>, now: number): boolean {
  return now >= game.startsAt;
}

export function spacesLabel(game: Pick<Game, 'capacity' | 'confirmedCount' | 'waitlistCount'>): string {
  const left = game.capacity - game.confirmedCount;
  if (left > 1) return `${left} spaces left`;
  if (left === 1) return '1 space left';
  return game.waitlistCount > 0 ? `Full · ${game.waitlistCount} waiting` : 'Full';
}
