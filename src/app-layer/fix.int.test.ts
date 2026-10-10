import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  addGhost,
  addGuest,
  confirmFix,
  createGroup,
  createMatch,
  dismissFix,
  generateDraftTeams,
  getInviteToken,
  getMatchRsvps,
  getProposedFix,
  getTeams,
  joinGroup,
  openRsvps,
  publishTeams,
  removeGuest,
  setRating,
  setRsvp,
  swapPlayers,
} from "./index";
import { byName, inAWeek, newUser } from "./test-support";

/**
 * Sean organises. `ratings` lists ghost players in RSVP order: the first `capacity` play and the rest queue.
 * If `teamA` is given, the draft is rearranged to put exactly those players on Team A before publishing.
 */
async function publishedMatch(ratings: Record<string, number>, capacity: number, teamA?: string[]) {
  const sean = await newUser();
  const groupId = await createGroup(sean, { name: "Thursday", ownerName: "Sean" });
  const matchId = await createMatch(sean, groupId, { startsAt: inAWeek(), capacity });
  await openRsvps(sean, matchId);
  const ids: Record<string, string> = {};
  for (const [name, rating] of Object.entries(ratings)) {
    ids[name] = await addGhost(sean, groupId, name);
    await setRating(sean, ids[name], rating);
    await setRsvp(sean, matchId, "in", { onBehalfOf: ids[name] });
  }
  await generateDraftTeams(sean, matchId);
  if (teamA) await arrange(sean, matchId, teamA);
  await publishTeams(sean, matchId);
  return { sean, groupId, matchId, ids, token: await getInviteToken(sean, groupId) };
}

async function arrange(sean: SupabaseClient, matchId: string, teamA: string[]) {
  const teams = (await getTeams(sean, matchId))!;
  const wanted = new Set(teamA);
  const wrongInA = teams.teamA.filter((p) => !wanted.has(p.displayName));
  const wrongInB = teams.teamB.filter((p) => wanted.has(p.displayName));
  for (let i = 0; i < wrongInA.length; i++) {
    await swapPlayers(sean, matchId, wrongInA[i]!.membershipId, wrongInB[i]!.membershipId);
  }
}

const sides = async (client: SupabaseClient, matchId: string) => {
  const teams = (await getTeams(client, matchId))!;
  const names = (side: { displayName: string }[]) => side.map((p) => p.displayName).sort();
  return { a: names(teams.teamA), b: names(teams.teamB), revision: teams.revision };
};

describe("Dropout with a Waitlist", () => {
  const squad = { A: 80, B: 70, C: 60, D: 50, W1: 55, W2: 40 };

  it("proposes promoting the first waitlisted player into the vacated slot, moving nobody else", async () => {
    const { sean, matchId, ids } = await publishedMatch(squad, 4, ["A", "D"]);
    await setRsvp(sean, matchId, "out", { onBehalfOf: ids.D! });

    const fix = (await getProposedFix(sean, matchId))!;

    expect(fix.vacated.map((p) => p.displayName)).toEqual(["D"]);
    expect(fix.promoted).toEqual([expect.objectContaining({ displayName: "W1", side: "A" })]);
    expect(fix.moved).toEqual([]);
    expect(fix.teamA.map((p) => p.displayName).sort()).toEqual(["A", "W1"]);
    expect(fix.teamB.map((p) => p.displayName).sort()).toEqual(["B", "C"]);
  });

  it("never changes the published Teams until an Admin confirms", async () => {
    const { sean, matchId, ids } = await publishedMatch(squad, 4, ["A", "D"]);
    const before = await sides(sean, matchId);

    await setRsvp(sean, matchId, "out", { onBehalfOf: ids.D! });
    await getProposedFix(sean, matchId);

    expect(await sides(sean, matchId)).toEqual(before);
    expect(byName(await getMatchRsvps(sean, matchId)).W1).toMatchObject({ status: "waitlist", waitlistPosition: 1 });
  });

  it("applies the fix on confirmation, promoting W1 and queueing W2 next", async () => {
    const { sean, matchId, ids } = await publishedMatch(squad, 4, ["A", "D"]);
    const before = await sides(sean, matchId);
    await setRsvp(sean, matchId, "out", { onBehalfOf: ids.D! });

    await confirmFix(sean, matchId, (await getProposedFix(sean, matchId))!);

    const after = await sides(sean, matchId);
    expect(after.a).toEqual(["A", "W1"]);
    expect(after.b).toEqual(["B", "C"]);
    expect(after.revision).toBe(before.revision + 1);
    const rsvps = byName(await getMatchRsvps(sean, matchId));
    expect(rsvps.W1).toMatchObject({ status: "playing" });
    expect(rsvps.W2).toMatchObject({ status: "waitlist", waitlistPosition: 1 });
    expect(await getProposedFix(sean, matchId)).toBeNull();
  });

  it("proposes nothing while everyone is still in", async () => {
    const { sean, matchId } = await publishedMatch(squad, 4);

    expect(await getProposedFix(sean, matchId)).toBeNull();
  });
});

describe("Dropout with no Waitlist", () => {
  it("moves the fewest players needed to rebalance", async () => {
    // Lopsided on purpose: {A90, C50} v {B10, D50}. When D drops it is 140 v 10.
    const { sean, matchId, ids } = await publishedMatch({ A: 90, B: 10, C: 50, D: 50 }, 4, ["A", "C"]);
    await setRsvp(sean, matchId, "out", { onBehalfOf: ids.D! });

    const fix = (await getProposedFix(sean, matchId))!;

    expect(fix.promoted).toEqual([]);
    expect(fix.moved).toEqual([expect.objectContaining({ displayName: "C", from: "A", to: "B" })]);
    expect(fix.balance).toBe(30);
    expect(fix.teamA.map((p) => p.displayName)).toEqual(["A"]);
    expect(fix.teamB.map((p) => p.displayName).sort()).toEqual(["B", "C"]);
  });

  it("leaves everyone where they are when a rebalance would barely help", async () => {
    // Balanced draft {A55, B45} v {C50, D50}. When D drops it is 100 v 50; the best alternative (A v B, C) is
    // 55 v 95, only 10 points closer: not worth moving anyone.
    const { sean, matchId, ids } = await publishedMatch({ A: 55, B: 45, C: 50, D: 50 }, 4);
    await setRsvp(sean, matchId, "out", { onBehalfOf: ids.D! });

    const fix = (await getProposedFix(sean, matchId))!;

    expect(fix.moved).toEqual([]);
    expect(fix.vacated.map((p) => p.displayName)).toEqual(["D"]);
    expect(fix.balance).toBe(50);
  });
});

describe("Confirming and dismissing", () => {
  const squad = { A: 80, B: 70, C: 60, D: 50, W1: 55, W2: 40 };

  it("lets an Admin dismiss a proposal, and proposes again after a new dropout", async () => {
    const { sean, matchId, ids } = await publishedMatch(squad, 4, ["A", "D"]);
    await setRsvp(sean, matchId, "out", { onBehalfOf: ids.D! });
    await dismissFix(sean, matchId, (await getProposedFix(sean, matchId))!);

    expect(await getProposedFix(sean, matchId)).toBeNull();

    await setRsvp(sean, matchId, "out", { onBehalfOf: ids.C! });
    const fix = (await getProposedFix(sean, matchId))!;
    expect(fix.vacated.map((p) => p.displayName).sort()).toEqual(["C", "D"]);
  });

  it("fills several vacated slots from the Waitlist in order", async () => {
    const { sean, matchId, ids } = await publishedMatch(squad, 4, ["A", "D"]);
    await setRsvp(sean, matchId, "out", { onBehalfOf: ids.C! });
    await setRsvp(sean, matchId, "out", { onBehalfOf: ids.D! });

    const fix = (await getProposedFix(sean, matchId))!;
    await confirmFix(sean, matchId, fix);

    const after = await sides(sean, matchId);
    expect([...after.a, ...after.b].sort()).toEqual(["A", "B", "W1", "W2"]);
  });

  it("is for Admins only", async () => {
    const { sean, matchId, ids, token } = await publishedMatch(squad, 4, ["A", "D"]);
    const priya = await newUser();
    await joinGroup(priya, token, { name: "Priya" });
    await setRsvp(sean, matchId, "out", { onBehalfOf: ids.D! });
    const fix = (await getProposedFix(sean, matchId))!;

    await expect(getProposedFix(priya, matchId)).rejects.toThrow();
    await expect(confirmFix(priya, matchId, fix)).rejects.toThrow(/only an admin/);
    await expect(dismissFix(priya, matchId, fix)).rejects.toThrow(/only an admin/);
  });

  it("refuses a hand-edited fix that skips the Waitlist order", async () => {
    const { sean, matchId, ids } = await publishedMatch(squad, 4, ["A", "D"]);
    await setRsvp(sean, matchId, "out", { onBehalfOf: ids.D! });
    const fix = (await getProposedFix(sean, matchId))!;
    const skipQueue = {
      ...fix,
      teamA: fix.teamA.map((p) => (p.displayName === "W1" ? { ...p, membershipId: ids.W2! } : p)),
    };

    await expect(confirmFix(sean, matchId, skipQueue)).rejects.toThrow(/waitlist/i);
  });

  it("refuses a fix that drops someone who is still in", async () => {
    const { sean, matchId, ids } = await publishedMatch(squad, 4, ["A", "D"]);
    await setRsvp(sean, matchId, "out", { onBehalfOf: ids.D! });
    const fix = (await getProposedFix(sean, matchId))!;
    const dropsB = { ...fix, teamB: fix.teamB.filter((p) => p.displayName !== "B") };

    await expect(confirmFix(sean, matchId, dropsB)).rejects.toThrow(/still in/i);
  });

  it("refuses a fix when nobody has dropped out", async () => {
    const { sean, matchId } = await publishedMatch(squad, 4, ["A", "D"]);
    const teams = (await getTeams(sean, matchId))!;
    const noOneLeft = {
      key: "",
      vacated: [],
      promoted: [],
      moved: [],
      teamA: teams.teamB,
      teamB: teams.teamA,
      balance: 0,
    };

    await expect(confirmFix(sean, matchId, noOneLeft)).rejects.toThrow(/nobody has dropped out/i);
  });

  it("shows players the updated Teams only after confirmation", async () => {
    const { sean, matchId, ids, token } = await publishedMatch(squad, 4, ["A", "D"]);
    const priya = await newUser();
    await joinGroup(priya, token, { name: "Priya" });
    const seen = await sides(priya, matchId);
    await setRsvp(sean, matchId, "out", { onBehalfOf: ids.D! });
    expect(await sides(priya, matchId)).toEqual(seen);

    await confirmFix(sean, matchId, (await getProposedFix(sean, matchId))!);

    const now = await sides(priya, matchId);
    expect(now.revision).toBe(seen.revision + 1);
    expect([...now.a, ...now.b]).toContain("W1");
  });
});

describe("removing a Guest after publishing", () => {
  it("vacates their place so a fix can promote the Waitlist", async () => {
    const sean = await newUser();
    const groupId = await createGroup(sean, { name: "Thursday", ownerName: "Sean" });
    const token = await getInviteToken(sean, groupId);
    const priya = await newUser();
    const priyaId = await joinGroup(priya, token, { name: "Priya" });
    await setRating(sean, priyaId, 60);
    const matchId = await createMatch(sean, groupId, { startsAt: inAWeek(), capacity: 4 });
    await openRsvps(sean, matchId);
    const rsvpGhost = async (name: string, rating: number) => {
      const id = await addGhost(sean, groupId, name);
      await setRating(sean, id, rating);
      await setRsvp(sean, matchId, "in", { onBehalfOf: id });
    };
    await rsvpGhost("A", 80);
    await rsvpGhost("B", 70);
    await setRsvp(priya, matchId, "in");
    const guest = await addGuest(priya, matchId, "Priya's brother");
    await rsvpGhost("W", 55); // fifth 'in': on the Waitlist
    await generateDraftTeams(sean, matchId);
    await publishTeams(sean, matchId);

    await removeGuest(priya, guest);

    const fix = (await getProposedFix(sean, matchId))!;
    expect(fix.vacated.map((p) => p.displayName)).toEqual(["Priya's brother"]);
    expect(fix.promoted.map((p) => p.displayName)).toEqual(["W"]);
    await confirmFix(sean, matchId, fix);
    const after = await sides(sean, matchId);
    expect([...after.a, ...after.b].sort()).toEqual(["A", "B", "Priya", "W"]);
  });
});
