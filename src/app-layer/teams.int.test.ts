import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  addGhost,
  createGroup,
  createMatch,
  generateDraftTeams,
  getInviteToken,
  getTeams,
  joinGroup,
  openRsvps,
  publishTeams,
  removePairRule,
  reshuffleDraftTeams,
  setHappyInGoal,
  setPairRule,
  setRating,
  setRsvp,
  swapPlayers,
} from "./index";
import { newUser } from "./test-support";

const inAWeek = () => new Date(Date.now() + 7 * 24 * 3600 * 1000);

/**
 * Sean organises. Each entry in `ratings` is a ghost profile Sean has rated and RSVPed 'in' for,
 * in the order given. Returns the ids by name.
 */
async function matchWith(ratings: Record<string, number>, capacity = 10) {
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
  return { sean, groupId, matchId, ids, token: await getInviteToken(sean, groupId) };
}

const names = (side: { displayName: string }[]) => side.map((p) => p.displayName).sort();

describe("Generating draft Teams", () => {
  it("balances the Teams using the Ratings", async () => {
    const { sean, matchId } = await matchWith({ Star: 90, Weak: 10, Mid1: 50, Mid2: 50 });

    await generateDraftTeams(sean, matchId);

    const teams = (await getTeams(sean, matchId))!;
    expect(teams.state).toBe("draft");
    const star = teams.teamA.some((p) => p.displayName === "Star") ? teams.teamA : teams.teamB;
    expect(names(star)).toEqual(["Star", "Weak"]);
  });

  it("uses only the playing players, leaving the Waitlist out", async () => {
    const { sean, matchId } = await matchWith({ A: 50, B: 50, C: 50, D: 50, Late1: 50, Late2: 50 }, 4);

    await generateDraftTeams(sean, matchId);

    const teams = (await getTeams(sean, matchId))!;
    expect(names([...teams.teamA, ...teams.teamB])).toEqual(["A", "B", "C", "D"]);
  });

  it("respects keep-apart pairs, and forgets them once removed", async () => {
    const { sean, matchId, ids } = await matchWith({ A: 80, B: 70, C: 60, D: 50 });
    // Without a rule, the best split is {A,D} v {B,C}: A and D together.
    await generateDraftTeams(sean, matchId);
    const before = (await getTeams(sean, matchId))!;
    expect(before.teamA.some((p) => p.displayName === "A") === before.teamA.some((p) => p.displayName === "D")).toBe(true);

    await setPairRule(sean, ids.A!, ids.D!, "apart");
    await generateDraftTeams(sean, matchId);
    const after = (await getTeams(sean, matchId))!;
    expect(after.teamA.some((p) => p.displayName === "A")).not.toBe(after.teamA.some((p) => p.displayName === "D"));

    await removePairRule(sean, ids.A!, ids.D!);
    await generateDraftTeams(sean, matchId);
    const again = (await getTeams(sean, matchId))!;
    expect(again.teamA.some((p) => p.displayName === "A")).toBe(again.teamA.some((p) => p.displayName === "D"));
  });

  it("gives each Team a happy-in-goal player when it can", async () => {
    const { sean, matchId, ids } = await matchWith({ K1: 50, K2: 50, A: 50, B: 50 });
    await setHappyInGoal(sean, ids.K1!, true);
    await setHappyInGoal(sean, ids.K2!, true);

    await generateDraftTeams(sean, matchId);

    const teams = (await getTeams(sean, matchId))!;
    expect(teams.teamA.some((p) => p.displayName.startsWith("K"))).toBe(true);
    expect(teams.teamB.some((p) => p.displayName.startsWith("K"))).toBe(true);
  });

  it("lets an Admin swap players and reshuffle to the next-best split", async () => {
    const { sean, matchId } = await matchWith({ A: 80, B: 70, C: 60, D: 50 });
    await generateDraftTeams(sean, matchId);
    const first = (await getTeams(sean, matchId))!;
    const [a1, b1] = [first.teamA[0]!, first.teamB[0]!];

    await swapPlayers(sean, matchId, a1.membershipId, b1.membershipId);
    const swapped = (await getTeams(sean, matchId))!;
    expect(swapped.teamA.map((p) => p.membershipId)).toContain(b1.membershipId);
    expect(swapped.teamB.map((p) => p.membershipId)).toContain(a1.membershipId);

    await reshuffleDraftTeams(sean, matchId);
    const reshuffled = (await getTeams(sean, matchId))!;
    const key = (t: typeof first) => names(t.teamA).join() + "|" + names(t.teamB).join();
    expect(key(reshuffled)).not.toBe(key(first));
  });

  it("is for Admins only", async () => {
    const { matchId, token } = await matchWith({ A: 50, B: 50 });
    const priya = await newUser();
    await joinGroup(priya, token, { name: "Priya" });

    await expect(generateDraftTeams(priya, matchId)).rejects.toThrow();
  });
});

describe("Draft privacy and publishing", () => {
  async function withDraft() {
    const setup = await matchWith({ A: 80, B: 70, C: 60, D: 50 });
    const player = await newUser();
    const playerId = await joinGroup(player, setup.token, { name: "Priya" });
    await setRsvp(player, setup.matchId, "in");
    await generateDraftTeams(setup.sean, setup.matchId);
    return { ...setup, player, playerId };
  }

  it("keeps draft Teams private to Admins, even from direct table queries", async () => {
    const { player, matchId } = await withDraft();

    expect(await getTeams(player, matchId)).toBeNull();
    expect((await player.from("teams").select("*")).data).toEqual([]);
    expect((await player.from("team_players").select("*")).data).toEqual([]);
  });

  it("shows published Teams to every confirmed member", async () => {
    const { sean, player, matchId } = await withDraft();

    await publishTeams(sean, matchId);

    const teams = (await getTeams(player, matchId))!;
    expect(teams.state).toBe("published");
    expect(teams.teamA.length + teams.teamB.length).toBe(5);
  });

  it("shows a player with an unconfirmed claim only their own Team", async () => {
    const { sean, groupId, token, matchId } = await withDraft();
    const ghost = await addGhost(sean, groupId, "Dave");
    await setRsvp(sean, matchId, "in", { onBehalfOf: ghost });
    await generateDraftTeams(sean, matchId);
    const dave = await newUser();
    await joinGroup(dave, token, { name: "Dave", claim: ghost });
    await publishTeams(sean, matchId);

    const teams = (await getTeams(dave, matchId))!;
    const mine = teams.teamA.some((p) => p.membershipId === ghost) ? teams.teamA : teams.teamB;
    const theirs = mine === teams.teamA ? teams.teamB : teams.teamA;
    expect(mine.some((p) => p.membershipId === ghost)).toBe(true);
    expect(theirs).toEqual([]);
  });

  it("never changes published Teams silently: swaps, reshuffles and regenerating are refused", async () => {
    const { sean, matchId } = await withDraft();
    await publishTeams(sean, matchId);
    const published = (await getTeams(sean, matchId))!;

    await expect(swapPlayers(sean, matchId, published.teamA[0]!.membershipId, published.teamB[0]!.membershipId)).rejects.toThrow();
    await expect(reshuffleDraftTeams(sean, matchId)).rejects.toThrow();
    await expect(generateDraftTeams(sean, matchId)).rejects.toThrow();
    expect(await getTeams(sean, matchId)).toEqual(published);
  });

  it("does not let players publish", async () => {
    const { player, matchId } = await withDraft();

    await expect(publishTeams(player, matchId)).rejects.toThrow();
  });

  it("keeps pair rules away from players", async () => {
    const { sean, player, ids } = await withDraft();
    await setPairRule(sean, ids.A!, ids.B!, "apart");

    expect((await player.from("pair_rules").select("*")).data).toEqual([]);
  });
});
