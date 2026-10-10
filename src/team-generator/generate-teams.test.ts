import { describe, expect, it } from "vitest";
import { generateTeams, scoreSplit, type Player, type Split } from "./index";

const player = (id: string, rating: number, extra: Partial<Player> = {}): Player => ({
  id,
  rating,
  ...extra,
});

const sameTeam = (split: Split, x: string, y: string) => split.teamA.includes(x) === split.teamA.includes(y);

// Independent oracle: try every way of choosing team A of size n/2 and take the best difference.
function bestPossibleBalance(ratings: number[]): number {
  const n = ratings.length;
  const total = ratings.reduce((a, b) => a + b, 0);
  let best = Infinity;
  for (let mask = 0; mask < 1 << n; mask++) {
    let size = 0;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        size++;
        sum += ratings[i]!;
      }
    }
    if (size !== Math.floor(n / 2)) continue;
    best = Math.min(best, Math.abs(total - 2 * sum));
  }
  return best;
}

describe("generateTeams: rating balance", () => {
  it("puts every player on exactly one team", () => {
    const players = [90, 80, 70, 60, 50, 40, 30, 20, 10, 55].map((r, i) => player(`p${i}`, r));
    const [best] = generateTeams(players, {});
    const everyone = [...best!.teamA, ...best!.teamB].sort();
    expect(everyone).toEqual(players.map((p) => p.id).sort());
    expect(best!.teamA).toHaveLength(5);
    expect(best!.teamB).toHaveLength(5);
  });

  it("returns the split with the smallest rating difference first", () => {
    const ratings = [90, 80, 70, 60, 50, 40, 30, 20, 10, 55];
    const players = ratings.map((r, i) => player(`p${i}`, r));
    const [best] = generateTeams(players, {});
    expect(best!.balance).toBe(bestPossibleBalance(ratings));
  });

  it("splits a known case perfectly", () => {
    const players = [player("a", 80), player("b", 60), player("c", 50), player("d", 30)];
    const [best] = generateTeams(players, {});
    expect(best!.balance).toBe(0);
    expect(sameTeam(best!, "a", "d")).toBe(true);
  });
});

describe("generateTeams: happy in goal", () => {
  const squad = (): Player[] => [
    player("k1", 70, { happyInGoal: true }),
    player("k2", 50, { happyInGoal: true }),
    player("a", 80),
    player("b", 60),
    player("c", 40),
    player("d", 20),
  ];

  it("gives each Team a happy-in-goal player when one exists for each side", () => {
    const [best] = generateTeams(squad(), {});
    const keepers = new Set(["k1", "k2"]);
    expect(best!.teamA.some((id) => keepers.has(id))).toBe(true);
    expect(best!.teamB.some((id) => keepers.has(id))).toBe(true);
    expect(best!.violations).toEqual([]);
  });

  it("reports a Team without a keeper when only one volunteer exists", () => {
    const players = squad().map((p) => (p.id === "k2" ? { ...p, happyInGoal: false } : p));
    const [best] = generateTeams(players, {});
    const withoutKeeper = best!.teamA.includes("k1") ? "B" : "A";
    expect(best!.violations).toEqual([{ kind: "no-happy-in-goal", team: withoutKeeper }]);
  });

  it("stays quiet when nobody in the pool is happy in goal", () => {
    const players = squad().map((p) => ({ ...p, happyInGoal: false }));
    const [best] = generateTeams(players, {});
    expect(best!.violations).toEqual([]);
  });

  it("treats a GK position tag as willing to play in goal", () => {
    const players = [
      player("gk1", 60, { position: "GK" }),
      player("gk2", 60, { position: "GK" }),
      player("a", 60),
      player("b", 60),
    ];
    const [best] = generateTeams(players, {});
    expect(sameTeam(best!, "gk1", "gk2")).toBe(false);
  });
});

describe("generateTeams: keep-together and keep-apart pairs", () => {
  // The perfectly balanced split is {a,d} vs {b,c}, so both rules below cost some balance.
  const players = [player("a", 80), player("b", 60), player("c", 50), player("d", 30)];

  it("honours a keep-together pair when it can", () => {
    const [best] = generateTeams(players, { together: [["a", "b"]] });
    expect(sameTeam(best!, "a", "b")).toBe(true);
    expect(best!.violations).toEqual([]);
  });

  it("honours a keep-apart pair when it can", () => {
    const [best] = generateTeams(players, { apart: [["a", "d"]] });
    expect(sameTeam(best!, "a", "d")).toBe(false);
    expect(best!.violations).toEqual([]);
  });

  it("reports the broken pair when contradictory rules make a violation unavoidable", () => {
    const [best] = generateTeams(players, { together: [["a", "b"]], apart: [["a", "b"]] });
    expect(best!.violations).toHaveLength(1);
    expect(best!.violations[0]).toMatchObject({ a: "a", b: "b" });
  });

  it("ignores rules about players who are not playing", () => {
    const [best] = generateTeams(players, { together: [["a", "zed"]] });
    expect(best!.violations).toEqual([]);
    expect(best!.balance).toBe(0);
  });

  it("tolerates a modest rating gap to keep a pair together, but not a huge one", () => {
    const lopsided = [player("a", 90), player("b", 90), player("c", 10), player("d", 10)];
    const [best] = generateTeams(lopsided, { together: [["a", "b"]] });
    // Keeping the two stars together costs 160 rating points: the rule yields and is reported.
    expect(best!.balance).toBe(0);
    expect(best!.violations).toEqual([{ kind: "pair-together-broken", a: "a", b: "b" }]);
  });
});

describe("generateTeams: position spreading", () => {
  it("spreads position tags across Teams when ratings allow", () => {
    const players = [
      player("att1", 60, { position: "attacker" }),
      player("att2", 60, { position: "attacker" }),
      player("def1", 60, { position: "defender" }),
      player("def2", 60, { position: "defender" }),
    ];
    const [best] = generateTeams(players, {});
    expect(sameTeam(best!, "att1", "att2")).toBe(false);
    expect(sameTeam(best!, "def1", "def2")).toBe(false);
    expect(best!.violations).toEqual([]);
  });

  it("does not report an imbalance that an odd head-count makes unavoidable", () => {
    const players = [
      player("att1", 60, { position: "attacker" }),
      player("att2", 60, { position: "attacker" }),
      player("att3", 60, { position: "attacker" }),
      player("x", 60),
    ];
    const [best] = generateTeams(players, {});
    expect(best!.violations).toEqual([]);
  });

  const attackersAndOthers = () => [
    player("att1", 55, { position: "attacker" }),
    player("att2", 55, { position: "attacker" }),
    player("x", 45),
    player("y", 45),
  ];

  it("splits the attackers when nothing stops it", () => {
    expect(generateTeams(attackersAndOthers(), {})[0]!.violations).toEqual([]);
  });

  it("reports an imbalance it could not avoid", () => {
    const players = attackersAndOthers();
    // A keep-together pair forces both attackers onto one Team.
    const [forced] = generateTeams(players, { together: [["att1", "att2"]] });
    expect(forced!.violations).toContainEqual({
      kind: "position-imbalance",
      position: "attacker",
      difference: 2,
    });
  });
});

describe("generateTeams: sizes and edge cases", () => {
  it("makes Teams differ in size by one for an odd number of players", () => {
    const players = [90, 70, 60, 50, 40, 30, 20].map((r, i) => player(`p${i}`, r));
    const [best] = generateTeams(players, {});
    expect(Math.abs(best!.teamA.length - best!.teamB.length)).toBe(1);
    expect(best!.teamA.length + best!.teamB.length).toBe(7);
  });

  it("lists every distinct split exactly once", () => {
    const even = Array.from({ length: 10 }, (_, i) => player(`p${i}`, 50));
    expect(generateTeams(even, {})).toHaveLength(126);
    const odd = Array.from({ length: 9 }, (_, i) => player(`p${i}`, 50));
    expect(generateTeams(odd, {})).toHaveLength(126);
  });

  it("balances a 14-player game as well as brute force can", () => {
    const players = Array.from({ length: 14 }, (_, i) => player(`p${i}`, 10 + i * 5));
    const [best] = generateTeams(players, {});
    expect(best!.teamA).toHaveLength(7);
    expect(best!.balance).toBe(bestPossibleBalance(players.map((p) => p.rating)));
  });

  it("copes with all-equal Ratings: every split is perfectly balanced", () => {
    const players = Array.from({ length: 10 }, (_, i) => player(`p${i}`, 50));
    const all = generateTeams(players, {});
    expect(all.every((split) => split.balance === 0)).toBe(true);
  });

  it("copes with one very strong player", () => {
    const players = [player("star", 100), ...Array.from({ length: 9 }, (_, i) => player(`p${i}`, 10))];
    const [best] = generateTeams(players, {});
    expect(best!.balance).toBe(bestPossibleBalance(players.map((p) => p.rating)));
  });

  it("returns nothing for an empty squad and a lone Team for one player", () => {
    expect(generateTeams([], {})).toEqual([]);
    const [only] = generateTeams([player("solo", 50)], {});
    expect(only).toMatchObject({ teamA: ["solo"], teamB: [], balance: 50 });
  });

  it("splits two players one each", () => {
    const [best] = generateTeams([player("a", 70), player("b", 40)], {});
    expect(best).toMatchObject({ teamA: ["a"], teamB: ["b"], balance: 30 });
  });

  it("rejects duplicate player ids", () => {
    expect(() => generateTeams([player("a", 50), player("a", 60)], {})).toThrow(/duplicate/i);
  });
});

describe("generateTeams: ranking", () => {
  const players = [90, 80, 70, 60, 50, 40, 30, 20].map((r, i) => player(`p${i}`, r));

  it("is deterministic, so reshuffle is predictable", () => {
    expect(generateTeams(players, {})).toEqual(generateTeams(players, {}));
  });

  it("with no rules, orders splits from smallest to largest rating gap", () => {
    const balances = generateTeams(players, {}).map((s) => s.balance);
    expect(balances).toEqual([...balances].sort((a, b) => a - b));
  });

  it("finds equally good balance whatever order players are supplied in", () => {
    const reversed = [...players].reverse();
    expect(generateTeams(reversed, {})[0]!.balance).toBe(generateTeams(players, {})[0]!.balance);
  });

  it("limits how many splits come back", () => {
    expect(generateTeams(players, {}, { limit: 3 })).toHaveLength(3);
  });
});

describe("scoreSplit: a hand-edited split (live Balance meter)", () => {
  const players = [player("a", 80), player("b", 60), player("c", 50), player("d", 30)];

  it("reports balance and violations for any split", () => {
    const split = scoreSplit(players, { apart: [["a", "b"]] }, ["a", "b"], ["c", "d"]);
    expect(split.balance).toBe(60);
    expect(split.violations).toEqual([{ kind: "pair-apart-broken", a: "a", b: "b" }]);
  });

  it("rejects a split that is not a partition of the players", () => {
    expect(() => scoreSplit(players, {}, ["a"], ["c", "d"])).toThrow();
    expect(() => scoreSplit(players, {}, ["a", "b", "c"], ["c", "d"])).toThrow();
  });
});

describe("generateTeams: very large games", () => {
  const players = Array.from({ length: 40 }, (_, i) => player(`p${i}`, 20 + ((i * 37) % 61)));

  it("still returns valid, well-balanced splits without searching every combination", () => {
    const result = generateTeams(players, {}, { limit: 5 });
    expect(result.length).toBeGreaterThan(0);
    for (const split of result) {
      expect([...split.teamA, ...split.teamB].sort()).toEqual(players.map((p) => p.id).sort());
      expect(split.teamA).toHaveLength(20);
    }
    expect(result[0]!.balance).toBeLessThanOrEqual(1);
  });

  it("ranks the bounded results best first", () => {
    const result = generateTeams(players, {}, { limit: 5 });
    const balances = result.map((s) => s.balance);
    expect(balances).toEqual([...balances].sort((a, b) => a - b));
  });

  it("honours pair rules in the bounded search too", () => {
    const [best] = generateTeams(players, { together: [["p0", "p1"]], apart: [["p2", "p3"]] }, { limit: 1 });
    expect(best!.violations).toEqual([]);
  });
});

describe("generateTeams: minimal-change fix after a dropout", () => {
  // Published Teams: A = a1..a5, B = b1..b5, all rated 50, so any 5v5 is perfectly balanced.
  const published = { teamA: ["a1", "a2", "a3", "a4", "a5"], teamB: ["b1", "b2", "b3", "b4", "b5"] };

  it("puts the first waitlisted player into the vacated slot, leaving everyone else where they were", () => {
    const players = [...published.teamA, ...published.teamB.slice(0, 4), "w1"].map((id) => player(id, 50));
    const [fix] = generateTeams(players, {}, { keepCloseTo: published });
    expect(fix!.teamA.sort()).toEqual(published.teamA);
    expect(fix!.teamB.sort()).toEqual(["b1", "b2", "b3", "b4", "w1"]);
    expect(fix!.moved).toBe(0);
  });

  it("keeps the published labels even when the generator would label the sides the other way round", () => {
    // p0 (first in the list) was on Team B originally.
    const players = ["b1", "a1", "a2", "a3", "a4", "b2", "b3", "b4", "w1", "a5"].map((id) => player(id, 50));
    const [fix] = generateTeams(players, {}, { keepCloseTo: published });
    expect(fix!.teamA.sort()).toEqual(published.teamA);
    expect(fix!.moved).toBe(0);
  });

  it("with no waitlist, moves the fewest players needed to rebalance", () => {
    // B loses its 90-rated star: 9 players left, A is now much stronger.
    const ratings: Record<string, number> = { a1: 60, a2: 50, a3: 50, a4: 40, a5: 40, b1: 60, b2: 50, b3: 40, b4: 30, b5: 90 };
    const players = Object.entries(ratings)
      .filter(([id]) => id !== "b5")
      .map(([id, r]) => player(id, r));
    const [fix] = generateTeams(players, {}, { keepCloseTo: published, tolerance: 20 });
    // Moving one 40-rated player from A to B brings the gap from 60 down to 20: within tolerance.
    const gapAfterOneMove = 20;
    expect(fix!.moved).toBe(1);
    expect(fix!.balance).toBe(gapAfterOneMove);
  });

  it("does not move anyone when the Teams are already close enough", () => {
    const players = [...published.teamA, ...published.teamB.slice(0, 4)].map((id) => player(id, 50));
    const [fix] = generateTeams(players, {}, { keepCloseTo: published });
    expect(fix!.moved).toBe(0);
  });

  it("leaves 'moved' undefined for ordinary generation", () => {
    const [best] = generateTeams([player("a", 50), player("b", 50)], {});
    expect(best!.moved).toBeUndefined();
  });
});
