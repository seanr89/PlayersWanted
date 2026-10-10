import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  addGhost,
  addGuest,
  createGroup,
  createMatch,
  generateDraftTeams,
  getInviteToken,
  joinGroup,
  openRsvps,
  publishTeams,
  reshuffleDraftTeams,
  setHappyInGoal,
  setPairRule,
  setPosition,
  setRating,
  setRsvp,
  swapPlayers,
} from "./index";
import { inAWeek, newUser } from "./test-support";
import { getTeamAssignmentView } from "./views";

/** Sean organises. Each entry is a ghost player with a Rating who is RSVPed in, in the order given. */
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
  return { sean, groupId, matchId, ids };
}

const names = (side: { displayName: string }[]) => side.map((p) => p.displayName).sort();

describe("The team-assignment view", () => {
  it("shows an Admin both sides with what they need to judge the split", async () => {
    const { sean, matchId, ids } = await matchWith({ A: 80, B: 70, C: 60, D: 50 });
    await setPosition(sean, ids.A!, "attacker");
    await setHappyInGoal(sean, ids.D!, true);
    await generateDraftTeams(sean, matchId);

    const view = await getTeamAssignmentView(sean, matchId);

    expect(view.state).toBe("draft");
    expect(names([...view.teamA, ...view.teamB])).toEqual(["A", "B", "C", "D"]);
    const everyone = [...view.teamA, ...view.teamB];
    expect(everyone.find((p) => p.displayName === "A")).toMatchObject({ rating: 80, position: "attacker", happyInGoal: false, isGuest: false });
    expect(everyone.find((p) => p.displayName === "D")).toMatchObject({ rating: 50, happyInGoal: true });
    expect(view.stale).toBe(false);
    expect(view.rank).toBe(0);
  });

  it("gives the generator's inputs, so the screen can score any swap on the device", async () => {
    const { sean, matchId, ids } = await matchWith({ A: 80, B: 70, C: 60, D: 50 });
    await setPairRule(sean, ids.A!, ids.B!, "apart");
    await generateDraftTeams(sean, matchId);

    const view = await getTeamAssignmentView(sean, matchId);

    expect(view.players.map((p) => p.id).sort()).toEqual(Object.values(ids).sort());
    expect(view.players.find((p) => p.id === ids.A)).toMatchObject({ rating: 80 });
    expect(view.rules.apart).toEqual([[ids.A, ids.B]]);
  });

  it("uses the Group average for a Guest nobody has rated yet, and says it is a Guest", async () => {
    const { sean, groupId, matchId } = await matchWith({ A: 80, B: 60 }, 5);
    const token = await getInviteToken(sean, groupId);
    const member = await newUser();
    await joinGroup(member, token, { name: "Priya" });
    await setRsvp(member, matchId, "in");
    await addGuest(member, matchId, "Priya's mate");
    await generateDraftTeams(sean, matchId);

    const view = await getTeamAssignmentView(sean, matchId);

    const guest = [...view.teamA, ...view.teamB].find((p) => p.displayName === "Priya's mate");
    expect(guest?.isGuest).toBe(true);
    expect(typeof guest?.rating).toBe("number");
  });

  it("says when the draft no longer matches who is playing", async () => {
    const { sean, matchId, ids } = await matchWith({ A: 80, B: 70, C: 60, D: 50 });
    await generateDraftTeams(sean, matchId);
    expect((await getTeamAssignmentView(sean, matchId)).stale).toBe(false);

    await setRsvp(sean, matchId, "out", { onBehalfOf: ids.D! });
    expect((await getTeamAssignmentView(sean, matchId)).stale).toBe(true);

    await generateDraftTeams(sean, matchId);
    expect((await getTeamAssignmentView(sean, matchId)).stale).toBe(false);
  });

  it("follows swaps and reshuffles", async () => {
    const { sean, matchId } = await matchWith({ A: 80, B: 70, C: 60, D: 50 });
    await generateDraftTeams(sean, matchId);
    const first = await getTeamAssignmentView(sean, matchId);

    await swapPlayers(sean, matchId, first.teamA[0]!.membershipId, first.teamB[0]!.membershipId);
    const swapped = await getTeamAssignmentView(sean, matchId);
    expect(swapped.teamA.map((p) => p.membershipId)).toContain(first.teamB[0]!.membershipId);

    await reshuffleDraftTeams(sean, matchId);
    expect((await getTeamAssignmentView(sean, matchId)).rank).toBe(1);
  });

  it("has no teams yet before any are made, but still lists who is playing", async () => {
    const { sean, matchId } = await matchWith({ A: 80, B: 70 });

    const view = await getTeamAssignmentView(sean, matchId);

    expect(view.state).toBe("none");
    expect(view.teamA).toEqual([]);
    expect(view.players).toHaveLength(2);
  });

  it("shows published teams as published", async () => {
    const { sean, matchId } = await matchWith({ A: 80, B: 70 }, 2);
    await generateDraftTeams(sean, matchId);
    await publishTeams(sean, matchId);

    const view = await getTeamAssignmentView(sean, matchId);

    expect(view.state).toBe("published");
    expect(view.stale).toBe(false);
  });

  it("is for Admins only, because it carries Ratings", async () => {
    const { sean, groupId, matchId } = await matchWith({ A: 80, B: 70 });
    await generateDraftTeams(sean, matchId);
    const player: SupabaseClient = await newUser();
    await joinGroup(player, await getInviteToken(sean, groupId), { name: "Priya" });

    await expect(getTeamAssignmentView(player, matchId)).rejects.toThrow(/only an admin/);
  });
});
