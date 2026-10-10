import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  addGhost,
  addGuest,
  confirmFix,
  createGroup,
  createMatch,
  deleteAccount,
  generateDraftTeams,
  getAttendanceBoard,
  getGroup,
  getInvite,
  getInviteToken,
  getMatchRsvps,
  getMyGroups,
  getOwnRecord,
  getProposedFix,
  getResult,
  getSquad,
  getTeams,
  joinGroup,
  leaveGroup,
  openRsvps,
  promoteToAdmin,
  publishTeams,
  recordResult,
  removeMembership,
  setPairRule,
  setRating,
  setRsvp,
  transferOwnership,
} from "./index";
import { byName, inAWeek, newUser, sql } from "./test-support";

const anHourAgo = () => new Date(Date.now() - 3600_000);

interface Member {
  client: SupabaseClient;
  id: string;
}

/** Sean owns a Group; each name joins as a rated member. */
async function groupWith(names: string[]) {
  const sean = await newUser();
  const groupId = await createGroup(sean, { name: "Thursday", ownerName: "Sean" });
  const token = await getInviteToken(sean, groupId);
  const members: Record<string, Member> = {};
  for (const name of names) {
    const client = await newUser();
    const id = await joinGroup(client, token, { name });
    await setRating(sean, id, 50);
    members[name] = { client, id };
  }
  const member = (name: string) => members[name]!;

  /** A Match everyone in `playing` RSVPs 'in' to, with published Teams. `started` makes it a past Match. */
  async function publishedMatch(playing: string[], started = true) {
    const matchId = await createMatch(sean, groupId, {
      startsAt: started ? anHourAgo() : inAWeek(),
      capacity: playing.length,
    });
    await openRsvps(sean, matchId);
    for (const name of playing) await setRsvp(member(name).client, matchId, "in");
    await generateDraftTeams(sean, matchId);
    await publishTeams(sean, matchId);
    return matchId;
  }
  return { sean, groupId, token, member, publishedMatch };
}

describe("Removing a Membership", () => {
  it("lets an Admin remove a member, who loses access and has their Rating deleted", async () => {
    const { sean, groupId, member } = await groupWith(["Zaphod"]);
    const { id, client } = member("Zaphod");

    await removeMembership(sean, id);

    expect((await getSquad(sean, groupId)).map((m) => m.displayName)).not.toContain("Zaphod");
    expect(await getSquad(client, groupId)).toEqual([]);
    expect((await getMyGroups(client)).map((g) => g.id)).not.toContain(groupId);
    expect(sql(`select count(*) from membership_ratings where membership_id = '${id}'`)).toBe("0");
  });

  it("never lets the Owner be removed, by an Admin or by themselves", async () => {
    const { sean, groupId, member } = await groupWith(["Priya"]);
    await promoteToAdmin(sean, member("Priya").id);
    const ownerId = (await getSquad(sean, groupId)).find((m) => m.role === "owner")!.id;

    await expect(removeMembership(member("Priya").client, ownerId)).rejects.toThrow(/owner cannot be removed/);
    await expect(removeMembership(sean, ownerId)).rejects.toThrow(/owner cannot be removed/);
  });

  it("is for Admins only", async () => {
    const { member } = await groupWith(["Priya", "Mo"]);

    await expect(removeMembership(member("Priya").client, member("Mo").id)).rejects.toThrow(/only an admin/);
  });

  it("deletes a ghost profile that never played, and clears its pair rules", async () => {
    const { sean, groupId, member } = await groupWith(["Priya"]);
    const ghost = await addGhost(sean, groupId, "Dave");
    await setPairRule(sean, ghost, member("Priya").id, "apart");

    await removeMembership(sean, ghost);

    expect(sql(`select count(*) from memberships where id = '${ghost}'`)).toBe("0");
    expect(sql(`select count(*) from pair_rules where a_membership_id = '${ghost}' or b_membership_id = '${ghost}'`)).toBe("0");
    expect((await getInvite(await newUser(), await getInviteToken(sean, groupId))).ghosts).toEqual([]);
  });
});

describe("Leaving a Group", () => {
  it("lets a member leave and later rejoin as a fresh Membership", async () => {
    const { groupId, token, member } = await groupWith(["Zaphod"]);
    const { client } = member("Zaphod");

    await leaveGroup(client, groupId);
    expect(await getSquad(client, groupId)).toEqual([]);

    await joinGroup(client, token, { name: "Zaphod" });
    expect((await getSquad(client, groupId)).map((m) => m.displayName)).toContain("Zaphod");
  });

  it("stops the Owner leaving until ownership is transferred", async () => {
    const { sean, groupId, member } = await groupWith(["Priya"]);
    await promoteToAdmin(sean, member("Priya").id);

    await expect(leaveGroup(sean, groupId)).rejects.toThrow(/transfer ownership or delete/);

    await transferOwnership(sean, member("Priya").id);
    await leaveGroup(sean, groupId);
    expect((await getGroup(member("Priya").client, groupId)).myRole).toBe("owner");
  });

  it("frees the player's place in matches still to come, so the Waitlist moves up", async () => {
    const { sean, groupId, member } = await groupWith(["A", "B"]);
    const matchId = await createMatch(sean, groupId, { startsAt: inAWeek(), capacity: 1 });
    await openRsvps(sean, matchId);
    await setRsvp(member("A").client, matchId, "in");
    await setRsvp(member("B").client, matchId, "in");

    await leaveGroup(member("A").client, groupId);

    expect(byName(await getMatchRsvps(sean, matchId)).B?.status).toBe("playing");
    expect(byName(await getMatchRsvps(sean, matchId)).A).toBeUndefined();
  });

  it("leaves a hole in published Teams for the minimal-change fix to deal with", async () => {
    const { sean, groupId, member } = await groupWith(["A", "B", "C", "W"]);
    const matchId = await createMatch(sean, groupId, { startsAt: inAWeek(), capacity: 3 });
    await openRsvps(sean, matchId);
    for (const name of ["A", "B", "C", "W"]) await setRsvp(member(name).client, matchId, "in");
    await generateDraftTeams(sean, matchId);
    await publishTeams(sean, matchId);

    await leaveGroup(member("A").client, groupId);

    const fix = (await getProposedFix(sean, matchId))!;
    expect(fix.promoted.map((p) => p.displayName)).toEqual(["W"]);
    await confirmFix(sean, matchId, fix);
    const teams = (await getTeams(sean, matchId))!;
    expect([...teams.teamA, ...teams.teamB].map((p) => p.displayName).sort()).toEqual(["B", "C", "W"]);
  });
});

describe("History survives, anonymised", () => {
  async function playedWithLeaver() {
    const g = await groupWith(["Zaphod", "B", "C", "D"]);
    const matchId = await g.publishedMatch(["Zaphod", "B", "C", "D"]);
    await recordResult(g.sean, matchId, { scoreA: 4, scoreB: 2 });
    return { ...g, matchId };
  }

  it("keeps the Match, Result and everyone else's record unchanged", async () => {
    const { sean, groupId, member, matchId } = await playedWithLeaver();
    const before = await getOwnRecord(member("B").client, groupId);

    await leaveGroup(member("Zaphod").client, groupId);

    expect(await getResult(sean, matchId)).toMatchObject({ scoreA: 4, scoreB: 2 });
    expect(await getOwnRecord(member("B").client, groupId)).toEqual(before);
    const board = await getAttendanceBoard(member("B").client, groupId);
    expect(board.find((r) => r.displayName === "B")?.played).toBe(1);
    expect(board.map((r) => r.displayName)).not.toContain("Zaphod");
  });

  it("still counts the leaver in the played Teams, but as a Former player", async () => {
    const { sean, groupId, member, matchId } = await playedWithLeaver();

    await leaveGroup(member("Zaphod").client, groupId);

    const teams = (await getTeams(sean, matchId))!;
    const names = [...teams.teamA, ...teams.teamB].map((p) => p.displayName).sort();
    expect(names).toEqual(["B", "C", "D", "Former player"]);
    expect(byName(await getMatchRsvps(sean, matchId))["Former player"]).toMatchObject({ status: "playing" });
  });

  it("leaves no trace of the leaver's name or Rating anywhere", async () => {
    const { sean, groupId, member } = await playedWithLeaver();
    await setPairRule(sean, member("Zaphod").id, member("B").id, "together");

    await removeMembership(sean, member("Zaphod").id);

    expect(sql(`select count(*) from memberships where group_id = '${groupId}' and display_name = 'Zaphod'`)).toBe("0");
    expect(sql(`select count(*) from membership_ratings where membership_id = '${member("Zaphod").id}'`)).toBe("0");
    expect(sql(`select count(*) from pair_rules where group_id = '${groupId}'`)).toBe("0");
    expect(sql(`select person_id is null from memberships where id = '${member("Zaphod").id}'`)).toBe("t");
  });

  it("removes Guests the leaver brought to matches still to come", async () => {
    const { sean, groupId, member } = await playedWithLeaver();
    const upcoming = await createMatch(sean, groupId, { startsAt: inAWeek() });
    await openRsvps(sean, upcoming);
    await addGuest(member("Zaphod").client, upcoming, "Zaphod's cousin Trillian");

    await leaveGroup(member("Zaphod").client, groupId);

    expect(await getMatchRsvps(sean, upcoming)).toEqual([]);
    expect(sql(`select count(*) from memberships where guest_match_id = '${upcoming}'`)).toBe("0");
  });
});

describe("Deleting an account", () => {
  it("anonymises the Person's history in every Group and erases the Person", async () => {
    const one = await groupWith(["Ford", "B", "C", "D"]);
    const matchId = await one.publishedMatch(["Ford", "B", "C", "D"]);
    await recordResult(one.sean, matchId, { scoreA: 1, scoreB: 0 });
    const ford = one.member("Ford").client;
    const second = await groupWith([]);
    const inSecond = await joinGroup(ford, second.token, { name: "Ford" });
    await setRating(second.sean, inSecond, 70);
    const userId = (await ford.auth.getUser()).data.user!.id;

    await deleteAccount(ford);

    expect(sql(`select count(*) from person where auth_user_id = '${userId}'`)).toBe("0");
    expect(sql(`select count(*) from auth.users where id = '${userId}'`)).toBe("0");
    const ids = `'${one.member("Ford").id}', '${inSecond}'`;
    expect(sql(`select count(*) from memberships where id in (${ids}) and display_name = 'Ford'`)).toBe("0");
    expect(sql(`select count(*) from memberships where id in (${ids}) and person_id is not null`)).toBe("0");
    expect(sql(`select count(*) from membership_ratings where membership_id = '${inSecond}'`)).toBe("0");
    expect(await getResult(one.sean, matchId)).toMatchObject({ scoreA: 1, scoreB: 0 });
    const teams = (await getTeams(one.sean, matchId))!;
    expect([...teams.teamA, ...teams.teamB].map((p) => p.displayName)).toContain("Former player");
  });

  it("makes an Owner hand over a Group that still has other members first", async () => {
    const { sean, groupId } = await groupWith(["Priya"]);

    await expect(deleteAccount(sean)).rejects.toThrow(/transfer ownership/);

    expect((await getGroup(sean, groupId)).myRole).toBe("owner");
  });

  it("deletes a Group the Owner is the only member of", async () => {
    const sean = await newUser();
    const groupId = await createGroup(sean, { name: "Solo", ownerName: "Sean" });

    await deleteAccount(sean);

    expect(sql(`select count(*) from groups where id = '${groupId}'`)).toBe("0");
  });
});

describe("A Group always has an Owner", () => {
  it("is enforced by the database, whatever route is taken", async () => {
    const { groupId } = await groupWith([]);

    expect(() => sql(`update memberships set role = 'member' where group_id = '${groupId}' and role = 'owner'`)).toThrow(
      /must always have an owner/,
    );
    expect(() => sql(`delete from memberships where group_id = '${groupId}' and role = 'owner'`)).toThrow(
      /must always have an owner/,
    );
    expect(sql(`select count(*) from memberships where group_id = '${groupId}' and role = 'owner'`)).toBe("1");
  });
});
