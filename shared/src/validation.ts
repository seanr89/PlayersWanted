import { DomainError } from './errors';
import { FORMATS, type Format, type GameInput } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

export const GAME_LIMITS = {
  maxDaysAhead: 90,
  durationMins: { min: 30, max: 180 },
  capacity: { min: 6, max: 22 },
  costPence: { min: 0, max: 5000 },
  notesMax: 500,
} as const;

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function invalid(message: string): never {
  throw new DomainError('invalid-argument', message);
}

function intInRange(value: unknown, min: number, max: number, message: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) invalid(message);
  return value;
}

export function requireId(raw: unknown, key: string): string {
  const value = isRecord(raw) ? raw[key] : undefined;
  if (typeof value !== 'string' || value.length === 0 || value.length > 128 || value.includes('/')) {
    invalid(`Missing or invalid ${key}.`);
  }
  return value;
}

export function validateGameInput(raw: unknown, now: number, opts: { existingStartsAt?: number } = {}): GameInput {
  if (!isRecord(raw)) invalid('Game details are missing.');
  const venueId = requireId(raw, 'venueId');

  const startsAt = raw.startsAt;
  if (typeof startsAt !== 'number' || !Number.isInteger(startsAt)) invalid('Choose a kick-off date and time.');
  const unchangedStart = opts.existingStartsAt !== undefined && startsAt === opts.existingStartsAt;
  if (!unchangedStart) {
    if (startsAt <= now) invalid('Kick-off must be in the future.');
    if (startsAt > now + GAME_LIMITS.maxDaysAhead * DAY_MS) invalid('Kick-off must be within the next 90 days.');
  }

  const { durationMins: d, capacity: c, costPence: p } = GAME_LIMITS;
  const durationMins = intInRange(raw.durationMins, d.min, d.max, 'Duration must be between 30 and 180 minutes.');
  const capacity = intInRange(raw.capacity, c.min, c.max, 'Capacity must be an even number from 6 to 22.');
  if (capacity % 2 !== 0) invalid('Capacity must be an even number from 6 to 22.');
  const costPerPlayerPence = intInRange(raw.costPerPlayerPence, p.min, p.max, 'Cost per player must be between £0 and £50.');

  if (typeof raw.format !== 'string' || !(FORMATS as readonly string[]).includes(raw.format)) {
    invalid(`Format must be one of ${FORMATS.join(', ')}.`);
  }
  const format = raw.format as Format;

  let notes: string | null = null;
  if (raw.notes !== undefined && raw.notes !== null) {
    if (typeof raw.notes !== 'string') invalid('Notes must be text.');
    const trimmed = raw.notes.trim();
    if (trimmed.length > GAME_LIMITS.notesMax) invalid('Notes must be 500 characters or fewer.');
    notes = trimmed === '' ? null : trimmed;
  }

  return { venueId, startsAt, durationMins, format, capacity, costPerPlayerPence, notes };
}
