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
  getAttendanceBoard,
  getInvite,
  getInviteToken,
  getProposedFix,
  joinGroup,
  leaveGroup,
  openRsvps,
  promoteGuest,
  promoteToAdmin,
  publishTeams,
  recordResult,
  removeMembership,
  setRating,
  setRsvp,
  transferOwnership,
} from "./index";
import { inAWeek, newUser, sql } from "./test-support";

const anHourAgo = () => new Date(Date.now() - 3600_000);

interface Member {
  client: SupabaseClient;
  id: string;
}

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

  async function publishedMatch(playing: string[], opts: { started?: boolean; capacity?: number } = {}) {
    const matchId = await createMatch(sean, groupId, {
      startsAt: opts.started === false ? inAWeek() : anHourAgo(),
      capacity: opts.capacity ?? playing.length,
    });
    await openRsvps(sean, matchId);
    for (const name of playing) await setRsvp(member(name).client, matchId, "in");
    await generateDraftTeams(sean, matchId);
    await publishTeams(sean, matchId);
    return matchId;
  }
  return { sean, groupId, token, member, publishedMatch };
}

describe("Departed placeholders are inert", () => {
  it("do not keep an Admin role", async () => {
    const { sean, groupId, member, publishedMatch } = await groupWith(["Priya", "B", "C", "D"]);
    await promoteToAdmin(sean, member("Priya").id);
    await recordResult(sean, await publishedMatch(["Priya", "B", "C", "D"]), { scoreA: 1, scoreB: 0 });

    await leaveGroup(member("Priya").client, groupId);

    expect(sql(`select role from memberships where id = '${member("Priya").id}'`)).toBe("member");
  });

  it("cannot be handed ownership", async () => {
    const { sean, groupId, member, publishedMatch } = await groupWith(["Priya", "B", "C", "D"]);
    await promoteToAdmin(sean, member("Priya").id);
    await recordResult(sean, await publishedMatch(["Priya", "B", "C", "D"]), { scoreA: 1, scoreB: 0 });
    await leaveGroup(member("Priya").client, groupId);

    await expect(transferOwnership(sean, member("Priya").id)).rejects.toThrow(/an admin/);
  });

  it("cannot be resurrected by promoting a Former guest", async () => {
    const { sean, groupId, member } = await groupWith(["Priya", "B", "C", "D"]);
    const matchId = await createMatch(sean, groupId, { startsAt: anHourAgo(), capacity: 5 });
    await openRsvps(sean, matchId);
    for (const name of ["Priya", "B", "C", "D"]) await setRsvp(member(name).client, matchId, "in");
    const guest = await addGuest(member("Priya").client, matchId, "Priya's mate");
    await generateDraftTeams(sean, matchId);
    await publishTeams(sean, matchId);
    await recordResult(sean, matchId, { scoreA: 2, scoreB: 1 });
    await leaveGroup(member("Priya").client, groupId);

    await expect(promoteGuest(sean, guest)).rejects.toThrow(/has left/);
  });
});

describe("Leaving while holding an unconfirmed claim", () => {
  async function claimedGhostWithHistory() {
    const g = await groupWith(["B", "C", "D"]);
    const ghost = await addGhost(g.sean, g.groupId, "Dave");
    await setRating(g.sean, ghost, 50);
    const matchId = await createMatch(g.sean, g.groupId, { startsAt: anHourAgo(), capacity: 4 });
    await openRsvps(g.sean, matchId);
    for (const name of ["B", "C", "D"]) await setRsvp(g.member(name).client, matchId, "in");
    await setRsvp(g.sean, matchId, "in", { onBehalfOf: ghost });
    await generateDraftTeams(g.sean, matchId);
    await publishTeams(g.sean, matchId);
    await recordResult(g.sean, matchId, { scoreA: 1, scoreB: 0 });
    const claimer = await newUser();
    await joinGroup(claimer, g.token, { name: "Dave", claim: ghost });
    return { ...g, ghost, claimer };
  }

  it("hands the ghost profile back, with its history, when the claimant leaves", async () => {
    const { sean, groupId, token, ghost, claimer } = await claimedGhostWithHistory();

    await leaveGroup(claimer, groupId);

    expect((await getInvite(await newUser(), token)).ghosts.map((g) => g.displayName)).toEqual(["Dave"]);
    expect((await getAttendanceBoard(sean, groupId)).find((r) => r.membershipId === ghost)).toMatchObject({
      displayName: "Dave",
      played: 1,
    });
  });

  it("does the same when an Admin removes the claimant", async () => {
    const { sean, token, ghost } = await claimedGhostWithHistory();

    await removeMembership(sean, ghost);

    expect((await getInvite(await newUser(), token)).ghosts.map((g) => g.displayName)).toEqual(["Dave"]);
  });
});

describe("Nothing is kept that history does not need", () => {
  it("drops a leaver's 'out' RSVPs on played matches, along with the late-dropout flag", async () => {
    const { sean, groupId, member, publishedMatch } = await groupWith(["A", "B", "C", "D", "Quitter"]);
    const matchId = await publishedMatch(["A", "B", "C", "D"], { started: true });
    await setRsvp(member("Quitter").client, matchId, "out");
    await recordResult(sean, matchId, { scoreA: 1, scoreB: 0 });
    const quitter = member("Quitter").id;
    expect(sql(`select count(*) from rsvps where membership_id = '${quitter}'`)).toBe("1");

    await leaveGroup(member("Quitter").client, groupId);

    expect(sql(`select count(*) from rsvps where membership_id = '${quitter}'`)).toBe("0");
    expect(sql(`select count(*) from memberships where id = '${quitter}'`)).toBe("0");
  });

  it("removes the placeholder once a confirmed fix has cleared its last slot", async () => {
    const { sean, groupId, member, publishedMatch } = await groupWith(["A", "B", "C", "W"]);
    const matchId = await publishedMatch(["A", "B", "C"], { started: false, capacity: 3 });
    await setRsvp(member("W").client, matchId, "in");
    const leaver = member("A").id;
    await leaveGroup(member("A").client, groupId);
    expect(sql(`select count(*) from memberships where id = '${leaver}'`)).toBe("1");

    await confirmFix(sean, matchId, (await getProposedFix(sean, matchId))!);

    expect(sql(`select count(*) from memberships where id = '${leaver}'`)).toBe("0");
  });

  it("erases the leaver's id from a dismissed fix", async () => {
    const { sean, groupId, member, publishedMatch } = await groupWith(["A", "B", "C", "D"]);
    const matchId = await publishedMatch(["A", "B", "C", "D"], { started: false });
    await setRsvp(member("D").client, matchId, "out");
    await dismissFix(sean, matchId, (await getProposedFix(sean, matchId))!);
    const dropout = member("D").id;
    expect(sql(`select dismissed_fix_key like '%${dropout}%' from teams where match_id = '${matchId}'`)).toBe("t");

    await leaveGroup(member("D").client, groupId);

    expect(sql(`select coalesce(dismissed_fix_key, '') like '%${dropout}%' from teams where match_id = '${matchId}'`)).toBe("f");
  });

  it("does not keep the date the leaver joined", async () => {
    const { sean, groupId, member, publishedMatch } = await groupWith(["A", "B", "C", "D"]);
    await recordResult(sean, await publishedMatch(["A", "B", "C", "D"]), { scoreA: 1, scoreB: 0 });

    await leaveGroup(member("A").client, groupId);

    expect(sql(`select created_at < '2000-01-01' from memberships where id = '${member("A").id}'`)).toBe("t");
  });
});

describe("Hardening", () => {
  it("keeps the anonymising routines out of reach of the API", () => {
    for (const fn of ["private.anonymise_membership(uuid)", "private.depart(uuid)", "private.check_group_has_owner()"]) {
      for (const role of ["anon", "authenticated"]) {
        expect(sql(`select has_function_privilege('${role}', '${fn}', 'execute')`)).toBe("f");
      }
    }
  });

  it("pins every SECURITY DEFINER function's search_path, including pg_temp", () => {
    const unpinned = sql(`
      select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.prosecdef and n.nspname in ('public', 'private')
        and not coalesce(p.proconfig::text like '%pg_temp%', false)`);
    expect(unpinned).toBe("0");
  });
});
