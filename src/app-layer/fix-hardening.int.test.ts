import { describe, expect, it } from "vitest";
import {
  addGhost,
  addGuest,
  confirmFix,
  createGroup,
  createMatch,
  generateDraftTeams,
  getGuests,
  getInviteToken,
  getProposedFix,
  getTeams,
  joinGroup,
  openRsvps,
  publishTeams,
  removeGuest,
  setRating,
  setRsvp,
} from "./index";
import { inAWeek, newUser, sql } from "./test-support";

/** Sean + Priya (member, rated 60) + ghosts A80, B70; capacity 4; Priya and her Guest are in; Teams published. */
async function publishedWithGuest(capacity = 4) {
  const sean = await newUser();
  const groupId = await createGroup(sean, { name: "Thursday", ownerName: "Sean" });
  const token = await getInviteToken(sean, groupId);
  const priya = await newUser();
  const priyaId = await joinGroup(priya, token, { name: "Priya" });
  await setRating(sean, priyaId, 60);
  const matchId = await createMatch(sean, groupId, { startsAt: inAWeek(), capacity });
  await openRsvps(sean, matchId);
  const ids: Record<string, string> = {};
  for (const [name, rating] of Object.entries({ A: 80, B: 70 })) {
    ids[name] = await addGhost(sean, groupId, name);
    await setRating(sean, ids[name], rating);
    await setRsvp(sean, matchId, "in", { onBehalfOf: ids[name] });
  }
  await setRsvp(priya, matchId, "in");
  const guest = await addGuest(priya, matchId, "Priya's brother");
  await generateDraftTeams(sean, matchId);
  await publishTeams(sean, matchId);
  return { sean, groupId, priya, matchId, guest, ids };
}

describe("confirm_fix input handling", () => {
  it("refuses empty or missing team lists instead of wiping the published Teams", async () => {
    const { sean, matchId, priya, guest } = await publishedWithGuest();
    await removeGuest(priya, guest);
    const before = await getTeams(sean, matchId);

    for (const args of [
      { p_team_a: null, p_team_b: null },
      { p_team_a: [], p_team_b: [] },
    ]) {
      const { error } = await sean.rpc("confirm_fix", { p_match: matchId, ...args });
      expect(error).not.toBeNull();
    }

    expect(await getTeams(sean, matchId)).toEqual(before);
  });

  it("insists the Waitlist is used in full: an Admin cannot just leave the slot empty", async () => {
    const { sean, groupId, matchId, priya, guest } = await publishedWithGuest();
    const waiting = await addGhost(sean, groupId, "W");
    await setRsvp(sean, matchId, "in", { onBehalfOf: waiting });
    await removeGuest(priya, guest);
    const fix = (await getProposedFix(sean, matchId))!;
    const withoutPromotion = { ...fix, teamA: fix.teamA.filter((p) => p.membershipId !== waiting), teamB: fix.teamB.filter((p) => p.membershipId !== waiting) };

    await expect(confirmFix(sean, matchId, withoutPromotion)).rejects.toThrow(/waitlist/i);
  });

  it("reports promoted players on the side they actually end up on", async () => {
    const { sean, groupId, matchId, priya, guest } = await publishedWithGuest();
    const waiting = await addGhost(sean, groupId, "W");
    await setRsvp(sean, matchId, "in", { onBehalfOf: waiting });
    await removeGuest(priya, guest);

    const fix = (await getProposedFix(sean, matchId))!;

    for (const p of fix.promoted) {
      const inA = fix.teamA.some((t) => t.membershipId === p.membershipId);
      expect(p.side).toBe(inA ? "A" : "B");
    }
  });

  it("tidies up a removed Guest once the fix is confirmed", async () => {
    const { sean, groupId, matchId, priya, guest } = await publishedWithGuest();
    const waiting = await addGhost(sean, groupId, "W");
    await setRsvp(sean, matchId, "in", { onBehalfOf: waiting });
    await removeGuest(priya, guest);
    expect((await getGuests(sean, matchId)).map((g) => g.id)).toContain(guest);

    await confirmFix(sean, matchId, (await getProposedFix(sean, matchId))!);

    expect(await getGuests(sean, matchId)).toEqual([]);
  });
});

describe("Guest abuse and lifecycle", () => {
  it("lets a sponsor remove a Guest only while the match is still being organised", async () => {
    const { sean, priya, matchId, guest } = await publishedWithGuest();
    sql(`update matches set status = 'played' where id = '${matchId}'`);

    await expect(removeGuest(priya, guest)).rejects.toThrow(/no longer be removed|not open/i);
    expect((await getTeams(sean, matchId))!.teamA.length + (await getTeams(sean, matchId))!.teamB.length).toBe(4);
  });

  it("limits how many Guests one member can bring to a match", async () => {
    const { priya, matchId } = await publishedWithGuest(20);

    await addGuest(priya, matchId, "Guest 2");
    await addGuest(priya, matchId, "Guest 3");
    await expect(addGuest(priya, matchId, "Guest 4")).rejects.toThrow(/limit/i);
  });

  it("does not let an Admin RSVP on behalf of a Guest from a different match", async () => {
    const { sean, groupId, guest } = await publishedWithGuest();
    const otherMatch = await createMatch(sean, groupId, { startsAt: inAWeek() });
    await openRsvps(sean, otherMatch);

    await expect(setRsvp(sean, otherMatch, "in", { onBehalfOf: guest })).rejects.toThrow(/not in this (group|match)/i);
  });
});
