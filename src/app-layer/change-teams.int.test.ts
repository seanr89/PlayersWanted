import { describe, expect, it } from "vitest";
import {
  addGhost,
  createGroup,
  createMatch,
  changePublishedTeams,
  generateDraftTeams,
  getInviteToken,
  getTeams,
  joinGroup,
  openRsvps,
  publishTeams,
  setRating,
  setRsvp,
} from "./index";
import { inAWeek, newUser } from "./test-support";

/** Sean organises a published 2 v 2 of A, B, C, D (capacity 4). */
async function published() {
  const sean = await newUser();
  const groupId = await createGroup(sean, { name: "Thursday", ownerName: "Sean" });
  const matchId = await createMatch(sean, groupId, { startsAt: inAWeek(), capacity: 4 });
  await openRsvps(sean, matchId);
  const ids: Record<string, string> = {};
  for (const [name, rating] of Object.entries({ A: 80, B: 70, C: 60, D: 50 })) {
    ids[name] = await addGhost(sean, groupId, name);
    await setRating(sean, ids[name], rating);
    await setRsvp(sean, matchId, "in", { onBehalfOf: ids[name] });
  }
  await generateDraftTeams(sean, matchId);
  await publishTeams(sean, matchId);
  const teams = (await getTeams(sean, matchId))!;
  const idsOf = (side: { membershipId: string }[]) => side.map((p) => p.membershipId);
  return { sean, groupId, matchId, ids, teamA: idsOf(teams.teamA), teamB: idsOf(teams.teamB) };
}

describe("Changing published Teams", () => {
  it("rearranges the same players, bumps the revision and keeps the Teams published", async () => {
    const { sean, matchId, teamA, teamB } = await published();
    const before = (await getTeams(sean, matchId))!;
    expect(before.revision).toBe(0);

    // Swap one player from each side.
    await changePublishedTeams(sean, matchId, {
      teamA: [teamB[0]!, teamA[1]!],
      teamB: [teamA[0]!, teamB[1]!],
    });

    const after = (await getTeams(sean, matchId))!;
    expect(after.revision).toBe(1);
    expect(after.teamA.map((p) => p.membershipId).sort()).toEqual([teamB[0]!, teamA[1]!].sort());
    expect(after.teamB.map((p) => p.membershipId).sort()).toEqual([teamA[0]!, teamB[1]!].sort());
  });

  it("is for Admins only, and a player's refusal changes nothing", async () => {
    const { sean, groupId, matchId, teamA, teamB } = await published();
    const player = await newUser();
    await joinGroup(player, await getInviteToken(sean, groupId), { name: "Priya" });

    await expect(
      changePublishedTeams(player, matchId, { teamA: [teamB[0]!, teamA[1]!], teamB: [teamA[0]!, teamB[1]!] }),
    ).rejects.toThrow(/only an admin/);

    expect((await getTeams(sean, matchId))!.revision).toBe(0);
  });

  it("needs published Teams: a draft is changed with swaps, not this", async () => {
    const sean = await newUser();
    const groupId = await createGroup(sean, { name: "Thursday", ownerName: "Sean" });
    const matchId = await createMatch(sean, groupId, { startsAt: inAWeek(), capacity: 2 });
    await openRsvps(sean, matchId);
    const a = await addGhost(sean, groupId, "A");
    const b = await addGhost(sean, groupId, "B");
    for (const id of [a, b]) await setRsvp(sean, matchId, "in", { onBehalfOf: id });
    await generateDraftTeams(sean, matchId);

    await expect(changePublishedTeams(sean, matchId, { teamA: [a], teamB: [b] })).rejects.toThrow(
      /no published teams/,
    );
  });

  it("must keep exactly the players already on the Teams", async () => {
    const { sean, groupId, matchId, ids, teamA, teamB } = await published();
    const outsider = await addGhost(sean, groupId, "E");

    await expect(
      changePublishedTeams(sean, matchId, { teamA: [teamA[0]!, outsider], teamB }),
    ).rejects.toThrow(/exactly the players/);
    await expect(changePublishedTeams(sean, matchId, { teamA: [teamA[0]!], teamB })).rejects.toThrow(
      /exactly the players/,
    );
    expect(ids.A).toBeDefined();
    expect((await getTeams(sean, matchId))!.revision).toBe(0);
  });

  it("refuses a player listed twice, an empty side, and a change that changes nothing", async () => {
    const { sean, matchId, teamA, teamB } = await published();

    await expect(
      changePublishedTeams(sean, matchId, { teamA: [teamA[0]!, teamA[0]!], teamB: [teamB[0]!, teamB[1]!] }),
    ).rejects.toThrow(/more than once|exactly the players/);
    await expect(
      changePublishedTeams(sean, matchId, { teamA: [...teamA, ...teamB], teamB: [] }),
    ).rejects.toThrow(/each team/);
    await expect(changePublishedTeams(sean, matchId, { teamA, teamB })).rejects.toThrow(/nothing to change/);
    expect((await getTeams(sean, matchId))!.revision).toBe(0);
  });

  it("waits for an unresolved dropout: confirm the fix first", async () => {
    const { sean, matchId, ids, teamA, teamB } = await published();
    await setRsvp(sean, matchId, "out", { onBehalfOf: ids.D! });

    await expect(
      changePublishedTeams(sean, matchId, { teamA: [teamB[0]!, teamA[1]!], teamB: [teamA[0]!, teamB[1]!] }),
    ).rejects.toThrow(/dropped out/);
  });
});
