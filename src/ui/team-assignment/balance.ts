import { generateTeams, scoreSplit, type Violation } from "../../team-generator";
import type { TeamAssignmentView } from "../../app-layer/views";

/** The Balance meter's scale. A placeholder until tuned in real use (the spec lists it under "defaults to confirm"). */
const EVEN_GAP = 5;
const CLOSE_GAP = 15;

export type Tone = "even" | "close" | "lopsided";

export const toneFor = (gap: number): Tone => (gap <= EVEN_GAP ? "even" : gap <= CLOSE_GAP ? "close" : "lopsided");
export const TONE_LABEL: Record<Tone, string> = { even: "Even", close: "Close", lopsided: "Lopsided" };

export interface Arrangement {
  a: string[];
  b: string[];
}

export interface Score {
  totalA: number;
  totalB: number;
  gap: number;
  tone: Tone;
  violations: Violation[];
}

/**
 * Why a Balance number cannot be shown, or null if it can. A number that left someone out would mislead, so we say so
 * instead: either the draft no longer matches who is playing, or someone on the teams has since left the Group.
 */
export function unavailableReason(view: TeamAssignmentView, arrangement: Arrangement): "stale" | "left" | null {
  if (view.state === "none") return null;
  const known = new Set(view.players.map((p) => p.id));
  if ([...arrangement.a, ...arrangement.b].some((id) => !known.has(id))) return "left";
  if (view.stale) return "stale";
  return null;
}

/**
 * Scores an arrangement with the same module that made the suggestion, so the meter and the generator can never
 * disagree. Call only when `unavailableReason` is null.
 */
export function scoreArrangement(view: TeamAssignmentView, arrangement: Arrangement): Score {
  const split = scoreSplit(view.players, view.rules, arrangement.a, arrangement.b);
  const ratingOf = new Map(view.players.map((p) => [p.id, p.rating]));
  const total = (ids: string[]) => ids.reduce((sum, id) => sum + (ratingOf.get(id) ?? 0), 0);
  return {
    totalA: total(arrangement.a),
    totalB: total(arrangement.b),
    gap: split.balance,
    tone: toneFor(split.balance),
    violations: split.violations,
  };
}

/** Swaps two players who are on different teams. */
export function swap(arrangement: Arrangement, x: string, y: string): Arrangement {
  const flip = (id: string) => (id === x ? y : id === y ? x : id);
  return { a: arrangement.a.map(flip), b: arrangement.b.map(flip) };
}

/** True if the arrangement is no longer the generator's suggestion it started from (the organiser has swapped people). */
export function hasBeenEdited(view: TeamAssignmentView, arrangement: Arrangement): boolean {
  const suggestion = generateTeams(view.players, view.rules, { limit: view.rank + 1 })[view.rank];
  if (!suggestion) return false;
  const key = (ids: string[]) => [...ids].sort().join(",");
  const mine = [key(arrangement.a), key(arrangement.b)].sort().join("|");
  return mine !== [key(suggestion.teamA), key(suggestion.teamB)].sort().join("|");
}
