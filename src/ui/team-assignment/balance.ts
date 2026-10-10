import { scoreSplit, type Violation } from "../../team-generator";
import type { TeamAssignmentView } from "../../app-layer/views";

/** The Balance meter's scale. A placeholder until tuned in real use (the spec lists it under "defaults to confirm"). */
export const EVEN_GAP = 5;
export const CLOSE_GAP = 15;

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
 * Scores an arrangement with the same module that made the suggestion, so the meter and the generator can never
 * disagree. Null when the arrangement does not cover exactly the players we can score (a stale draft), in which case
 * the screen asks for the teams to be made again instead of showing a number that would mislead.
 */
export function scoreArrangement(view: TeamAssignmentView, arrangement: Arrangement): Score | null {
  const known = new Set(view.players.map((p) => p.id));
  const a = arrangement.a.filter((id) => known.has(id));
  const b = arrangement.b.filter((id) => known.has(id));
  try {
    const split = scoreSplit(view.players, view.rules, a, b);
    const total = (ids: string[]) => ids.reduce((sum, id) => sum + view.players.find((p) => p.id === id)!.rating, 0);
    return { totalA: total(a), totalB: total(b), gap: split.balance, tone: toneFor(split.balance), violations: split.violations };
  } catch {
    return null;
  }
}

/** Swaps two players who are on different teams. */
export function swap(arrangement: Arrangement, x: string, y: string): Arrangement {
  const flip = (id: string) => (id === x ? y : id === y ? x : id);
  return { a: arrangement.a.map(flip), b: arrangement.b.map(flip) };
}
