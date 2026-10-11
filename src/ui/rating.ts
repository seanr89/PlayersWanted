/** The Rating a new Membership starts on (also what the database defaults to). */
export const DEFAULT_RATING = 50;

export interface RatingBand {
  from: number;
  to: number;
  label: string;
}

/**
 * Anchor bands that make a bare 1 to 100 easier to apply consistently. The wording is a placeholder until tuned in
 * real use (the spec lists it under "defaults to confirm").
 */
export const RATING_BANDS: readonly RatingBand[] = [
  { from: 1, to: 20, label: "Just turns up" },
  { from: 21, to: 40, label: "Casual kickabout" },
  { from: 41, to: 60, label: "Solid Sunday player" },
  { from: 61, to: 80, label: "Good club player" },
  { from: 81, to: 100, label: "Ex-semi-pro" },
];

export function clampRating(value: number): number {
  if (Number.isNaN(value)) return DEFAULT_RATING;
  return Math.min(100, Math.max(1, Math.round(value)));
}

export function bandFor(rating: number): RatingBand {
  const r = clampRating(rating);
  return RATING_BANDS.find((b) => r >= b.from && r <= b.to)!;
}
