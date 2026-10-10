export type Position = "GK" | "defender" | "attacker";

export interface Player {
  id: string;
  rating: number;
  position?: Position;
  happyInGoal?: boolean;
}

export interface Rules {
  /** Pairs of player ids the admin wants on the same Team. */
  together?: [string, string][];
  /** Pairs of player ids the admin wants on opposite Teams. */
  apart?: [string, string][];
}

export type Violation =
  | { kind: "pair-together-broken"; a: string; b: string }
  | { kind: "pair-apart-broken"; a: string; b: string }
  | { kind: "no-happy-in-goal"; team: "A" | "B" }
  | { kind: "position-imbalance"; position: Position; difference: number };

export interface Teams {
  teamA: string[];
  teamB: string[];
}

export interface Split extends Teams {
  /** Absolute difference between the two Teams' total Ratings. */
  balance: number;
  violations: Violation[];
  /** Only set when `keepCloseTo` is used: how many players changed Team. */
  moved?: number;
}

export interface GenerateOptions {
  /** Return at most this many splits (best first). Default: all of them, or 50 for very large games. */
  limit?: number;
  /**
   * Published Teams to stay close to (the minimal-change fix). Splits within `tolerance`
   * of the best cost are ranked by fewest players moved, then by cost. Players who are
   * not in the published Teams (e.g. a replacement) are free to go anywhere.
   */
  keepCloseTo?: Teams;
  /** How much worse than the best split (in cost points) we accept to avoid moving people. Default 10. */
  tolerance?: number;
}

/**
 * How much each kind of problem costs, in Rating points, when ranking splits.
 * Rating balance is the base cost; these weights say how much imbalance an
 * admin's preference is worth. Tuned during the team-assignment prototype.
 */
export const PENALTY = {
  brokenPair: 100,
  teamWithoutKeeper: 30,
  positionImbalance: 5,
} as const;

/** Up to this many players every split is checked. Beyond it a bounded search is used. */
export const EXHAUSTIVE_LIMIT = 20;
const DEFAULT_BOUNDED_LIMIT = 50;
const DEFAULT_TOLERANCE = 10;
const RESTARTS = 8;

/** side[i] === 1 means player i is on Team A. */
type Side = Uint8Array;
interface Candidate {
  side: Side;
  cost: number;
}

export function generateTeams(players: Player[], rules: Rules, options: GenerateOptions = {}): Split[] {
  assertUniqueIds(players);
  const n = players.length;
  if (n === 0) return [];
  const scorer = makeScorer(players, rules);
  const exhaustive = n <= EXHAUSTIVE_LIMIT;
  let candidates = exhaustive ? enumerate(n, scorer) : boundedSearch(players, scorer, options);
  candidates.sort(byCostThenLayout);

  let moved: number[] | undefined;
  if (options.keepCloseTo) {
    const anchor = anchorSides(players, options.keepCloseTo);
    const ranked = candidates.map((c) => align(c, anchor, scorer));
    const eligibleCost = ranked[0]!.cost + (options.tolerance ?? DEFAULT_TOLERANCE);
    const withinTolerance = ranked.filter((r) => r.cost <= eligibleCost);
    const rest = ranked.slice(withinTolerance.length);
    withinTolerance.sort((x, y) => x.moved - y.moved || x.cost - y.cost || compareSides(x.side, y.side));
    const ordered = [...withinTolerance, ...rest];
    candidates = ordered;
    moved = ordered.map((r) => r.moved);
  }

  const limit = options.limit ?? (exhaustive ? undefined : DEFAULT_BOUNDED_LIMIT);
  return candidates.slice(0, limit).map((c, i) => {
    const split = scorer.split(c.side);
    return moved ? { ...split, moved: moved[i]! } : split;
  });
}

/** Scores one specific split, e.g. after the admin has swapped players by hand. */
export function scoreSplit(players: Player[], rules: Rules, teamA: string[], teamB: string[]): Split {
  assertUniqueIds(players);
  const ids = new Set(players.map((p) => p.id));
  const placed = [...teamA, ...teamB];
  if (placed.length !== ids.size || new Set(placed).size !== placed.length || placed.some((id) => !ids.has(id))) {
    throw new Error("teamA and teamB must together contain each player exactly once");
  }
  const inA = new Set(teamA);
  const side = Uint8Array.from(players, (p) => (inA.has(p.id) ? 1 : 0));
  return makeScorer(players, rules).split(side);
}

function assertUniqueIds(players: Player[]): void {
  if (new Set(players.map((p) => p.id)).size !== players.length) {
    throw new Error("Duplicate player id");
  }
}

function penaltyFor(v: Violation): number {
  switch (v.kind) {
    case "pair-together-broken":
    case "pair-apart-broken":
      return PENALTY.brokenPair;
    case "no-happy-in-goal":
      return PENALTY.teamWithoutKeeper;
    case "position-imbalance":
      return PENALTY.positionImbalance * v.difference;
  }
}

type Scorer = ReturnType<typeof makeScorer>;

/** Every distinct two-team split, once each (Team A always holds the first player). */
function enumerate(n: number, scorer: Scorer): Candidate[] {
  const sizes = [...new Set([Math.floor(n / 2), Math.ceil(n / 2)])].filter((s) => s >= 1);
  const out: Candidate[] = [];
  for (let mask = 1; mask < 1 << n; mask += 2) {
    if (!sizes.includes(popcount(mask))) continue;
    const side = new Uint8Array(n);
    for (let i = 0; i < n; i++) side[i] = (mask >> i) & 1;
    out.push({ side, cost: scorer.cost(side) });
  }
  return out;
}

/**
 * For games too big to check every split: hill-climb by swapping players between
 * Teams from a greedy start, an anchor-shaped start and a few seeded shuffles, then
 * keep the local optima and their one-swap neighbours.
 */
function boundedSearch(players: Player[], scorer: Scorer, options: GenerateOptions): Candidate[] {
  const n = players.length;
  const sizeA = Math.ceil(n / 2);
  const starts: Side[] = [greedyStart(players.map((p) => p.rating), sizeA)];
  if (options.keepCloseTo) starts.push(anchorStart(players, options.keepCloseTo, sizeA));
  const random = seededRandom(n);
  for (let r = 0; r < RESTARTS; r++) {
    const order = Array.from({ length: n }, (_, i) => i).sort(() => random() - 0.5);
    const side = new Uint8Array(n);
    order.slice(0, sizeA).forEach((i) => (side[i] = 1));
    starts.push(side);
  }

  const pool = new Map<string, Candidate>();
  const add = (side: Side) => {
    const canonical = side[0] === 1 ? side : flip(side);
    const key = canonical.join("");
    if (!pool.has(key)) pool.set(key, { side: canonical, cost: scorer.cost(canonical) });
  };
  for (const start of starts) {
    const optimum = climb(start, scorer);
    add(optimum);
    forEachSwap(optimum, (swapped) => add(swapped));
  }
  return [...pool.values()];
}

function climb(start: Side, scorer: Scorer): Side {
  let current = start;
  let currentCost = scorer.cost(current);
  for (;;) {
    let best: Side | undefined;
    let bestCost = currentCost;
    forEachSwap(current, (swapped) => {
      const cost = scorer.cost(swapped);
      if (cost < bestCost) {
        best = swapped;
        bestCost = cost;
      }
    });
    if (!best) return current;
    current = best;
    currentCost = bestCost;
  }
}

function forEachSwap(side: Side, visit: (swapped: Side) => void): void {
  for (let i = 0; i < side.length; i++) {
    if (side[i] !== 1) continue;
    for (let j = 0; j < side.length; j++) {
      if (side[j] !== 0) continue;
      const swapped = side.slice();
      swapped[i] = 0;
      swapped[j] = 1;
      visit(swapped);
    }
  }
}

/** Published players stay where they were; newcomers fill Team A until it is full. */
function anchorStart(players: Player[], anchor: Teams, sizeA: number): Side {
  const was = anchorSides(players, anchor);
  const side = new Uint8Array(players.length);
  was.forEach((w, i) => {
    if (w === 1) side[i] = 1;
  });
  let countA = side.reduce((sum, v) => sum + v, 0);
  was.forEach((w, i) => {
    if (w === undefined && countA < sizeA) {
      side[i] = 1;
      countA++;
    }
  });
  return side;
}

function greedyStart(ratings: number[], sizeA: number): Side {
  const n = ratings.length;
  const side = new Uint8Array(n);
  let totalA = 0;
  let totalB = 0;
  let countA = 0;
  let countB = 0;
  const byStrength = ratings.map((r, i) => [r, i] as const).sort((x, y) => y[0] - x[0] || x[1] - y[1]);
  for (const [rating, i] of byStrength) {
    const aHasRoom = countA < sizeA;
    const bHasRoom = countB < n - sizeA;
    const toA = aHasRoom && (!bHasRoom || totalA <= totalB);
    if (toA) {
      side[i] = 1;
      totalA += rating;
      countA++;
    } else {
      totalB += rating;
      countB++;
    }
  }
  return side;
}

/** mulberry32: small deterministic generator that stays within 32-bit integer maths. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** For each player: 1 = was on Team A, 0 = was on Team B, undefined = not in the published Teams. */
function anchorSides(players: Player[], anchor: Teams): (0 | 1 | undefined)[] {
  const a = new Set(anchor.teamA);
  const b = new Set(anchor.teamB);
  return players.map((p) => (a.has(p.id) ? 1 : b.has(p.id) ? 0 : undefined));
}

/** Counts movers under the better of the two labellings and flips the split to match it. */
function align(c: Candidate, anchor: (0 | 1 | undefined)[], scorer: Scorer): Candidate & { moved: number } {
  let agree = 0;
  let differ = 0;
  anchor.forEach((was, i) => {
    if (was === undefined) return;
    if (was === c.side[i]) agree++;
    else differ++;
  });
  // Swapping the labels turns every agreeing player into a mover and vice versa.
  if (agree < differ) {
    const side = flip(c.side);
    return { side, cost: scorer.cost(side), moved: agree };
  }
  return { ...c, moved: differ };
}

/** Swaps which Team everyone is on. */
function flip(side: Side): Side {
  return side.map((v) => 1 - v);
}

function byCostThenLayout(x: Candidate, y: Candidate): number {
  return x.cost - y.cost || compareSides(x.side, y.side);
}

function compareSides(x: Side, y: Side): number {
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return y[i]! - x[i]!;
  return 0;
}

function makeScorer(players: Player[], rules: Rules) {
  const n = players.length;
  const indexOf = new Map(players.map((p, i) => [p.id, i]));
  const pairs = (list: [string, string][] | undefined, kind: "together" | "apart") =>
    (list ?? []).flatMap(([a, b]) => {
      const i = indexOf.get(a);
      const j = indexOf.get(b);
      return i === undefined || j === undefined ? [] : [{ kind, a, b, i, j }];
    });
  const allPairs = [...pairs(rules.together, "together"), ...pairs(rules.apart, "apart")];
  const canKeep = players.map((p) => p.happyInGoal === true || p.position === "GK");
  const anyKeeper = canKeep.some(Boolean);
  const positions = [...new Set(players.flatMap((p) => (p.position ? [p.position] : [])))];
  const ratings = players.map((p) => p.rating);
  const total = ratings.reduce((a, b) => a + b, 0);

  function violations(side: Side): Violation[] {
    const out: Violation[] = [];
    for (const { kind, a, b, i, j } of allPairs) {
      const same = side[i] === side[j];
      if (kind === "together" && !same) out.push({ kind: "pair-together-broken", a, b });
      if (kind === "apart" && same) out.push({ kind: "pair-apart-broken", a, b });
    }
    if (anyKeeper) {
      const aHas = canKeep.some((k, i) => k && side[i] === 1);
      const bHas = canKeep.some((k, i) => k && side[i] === 0);
      if (!aHas) out.push({ kind: "no-happy-in-goal", team: "A" });
      if (!bHas) out.push({ kind: "no-happy-in-goal", team: "B" });
    }
    for (const position of positions) {
      let a = 0;
      let b = 0;
      for (let i = 0; i < n; i++) {
        if (players[i]!.position !== position) continue;
        if (side[i] === 1) a++;
        else b++;
      }
      // An odd number of players with a tag can never split evenly.
      const difference = Math.abs(a - b) - ((a + b) % 2);
      if (difference > 0) out.push({ kind: "position-imbalance", position, difference });
    }
    return out;
  }

  function balance(side: Side): number {
    let sumA = 0;
    for (let i = 0; i < n; i++) if (side[i] === 1) sumA += ratings[i]!;
    return Math.abs(total - 2 * sumA);
  }

  return {
    cost(side: Side): number {
      let cost = balance(side);
      for (const v of violations(side)) cost += penaltyFor(v);
      return cost;
    },
    split(side: Side): Split {
      return {
        teamA: players.filter((_, i) => side[i] === 1).map((p) => p.id),
        teamB: players.filter((_, i) => side[i] === 0).map((p) => p.id),
        balance: balance(side),
        violations: violations(side),
      };
    },
  };
}

function popcount(x: number): number {
  let c = 0;
  for (; x; x &= x - 1) c++;
  return c;
}
