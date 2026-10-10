import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  addGhost,
  addGuest,
  cancelMatch,
  createGroup,
  createMatch,
  generateDraftTeams,
  getInviteToken,
  joinGroup,
  openRsvps,
  publishTeams,
  recordResult,
  setRating,
  setRsvp,
  updateGroup,
} from "./index";
import { inAWeek, newUser } from "./test-support";
import { getMyMembership, getNextMatchView } from "./views";

const HOUR = 3600_000;
const inHours = (h: number) => new Date(Date.now() + h * HOUR);

interface Member {
  client: SupabaseClient;
  id: string;
}

async function league(names: string[], minPlayers?: number) {
  const sean = await newUser();
  const groupId = await createGroup(sean, { name: "Thursday", ownerName: "Sean" });
  if (minPlayers) await updateGroup(sean, groupId, { minPlayers });
  const token = await getInviteToken(sean, groupId);
  const members: Record<string, Member> = {};
  for (const name of names) {
    const client = await newUser();
    const id = await joinGroup(client, token, { name });
    await setRating(sean, id, 50);
    members[name] = { client, id };
  }
  return { sean, groupId, token, member: (n: string) => members[n]! };
}

describe("My membership", () => {
  it("tells me who I am in a Group, and nothing if I am not in it", async () => {
    const { sean, groupId, member } = await league(["Priya"]);

    expect(await getMyMembership(sean, groupId)).toMatchObject({ displayName: "Sean", role: "owner", claim: "confirmed" });
    expect(await getMyMembership(member("Priya").client, groupId)).toMatchObject({ id: member("Priya").id, role: "member" });
    expect(await getMyMembership(await newUser(), groupId)).toBeNull();
  });
});

describe("The next match", () => {
  it("is empty when nothing is scheduled", async () => {
    const { sean, groupId } = await league([]);

    expect(await getNextMatchView(sean, groupId)).toMatchObject({ match: null });
  });

  it("is the earliest match still to be played, skipping cancelled and played ones", async () => {
    const { sean, groupId } = await league([]);
    const cancelled = await createMatch(sean, groupId, { startsAt: inHours(24) });
    await cancelMatch(sean, cancelled);
    const next = await createMatch(sean, groupId, { startsAt: inHours(48) });
    await createMatch(sean, groupId, { startsAt: inHours(72) });

    expect((await getNextMatchView(sean, groupId)).match?.id).toBe(next);
  });

  it("shows a player their own RSVP, who is in, and how many spots are left", async () => {
    const { sean, groupId, member } = await league(["A", "B", "C"]);
    const matchId = await createMatch(sean, groupId, { startsAt: inHours(48), capacity: 2 });
    await openRsvps(sean, matchId);
    const a = member("A").client;

    expect((await getNextMatchView(a, groupId)).myRsvp).toEqual({ response: null, status: null });

    await setRsvp(a, matchId, "in");
    await setRsvp(member("B").client, matchId, "in");
    await setRsvp(member("C").client, matchId, "in");

    const view = await getNextMatchView(member("C").client, groupId);
    expect(view.myRsvp).toEqual({ response: "in", status: "waitlist", waitlistPosition: 1 });
    expect(view.counts).toMatchObject({ playing: 2, waitlisted: 1, spotsLeft: 0 });
    expect(view.whosIn.map((p) => [p.displayName, p.status])).toEqual([
      ["A", "playing"],
      ["B", "playing"],
      ["C", "waitlist"],
    ]);

    await setRsvp(a, matchId, "out");
    expect((await getNextMatchView(a, groupId)).myRsvp).toEqual({ response: "out", status: "out" });
  });

  it("gives players no admin fields and no Ratings, and admins their next action", async () => {
    const { sean, groupId, member } = await league(["A"]);
    await createMatch(sean, groupId, { startsAt: inHours(48) });

    const asPlayer = await getNextMatchView(member("A").client, groupId);
    expect(asPlayer).not.toHaveProperty("admin");
    expect(JSON.stringify(asPlayer)).not.toMatch(/rating/i);
    expect((await getNextMatchView(sean, groupId)).admin).toBeDefined();
  });

  it("includes Guests, marked as such", async () => {
    const { sean, groupId, member } = await league(["A"]);
    const matchId = await createMatch(sean, groupId, { startsAt: inHours(48) });
    await openRsvps(sean, matchId);
    await setRsvp(member("A").client, matchId, "in");
    await addGuest(member("A").client, matchId, "A's mate");

    const view = await getNextMatchView(member("A").client, groupId);

    expect(view.whosIn.find((p) => p.displayName === "A's mate")).toMatchObject({ isGuest: true });
  });
});

describe("What the Admin should do next", () => {
  const action = async (client: SupabaseClient, groupId: string) => (await getNextMatchView(client, groupId)).admin?.nextAction;

  it("walks through the life of a match", async () => {
    const { sean, groupId, member } = await league(["A", "B", "C", "D"], 4);
    const matchId = await createMatch(sean, groupId, { startsAt: inHours(48), capacity: 4 });
    expect(await action(sean, groupId)).toBe("open_rsvps");

    await openRsvps(sean, matchId);
    expect(await action(sean, groupId)).toBe("nudge"); // 0 in, the minimum is 4

    for (const n of ["A", "B", "C", "D"]) await setRsvp(member(n).client, matchId, "in");
    expect(await action(sean, groupId)).toBe("generate_teams");

    await generateDraftTeams(sean, matchId);
    expect(await action(sean, groupId)).toBe("publish_teams");

    await publishTeams(sean, matchId);
    expect(await action(sean, groupId)).toBe("nothing");

    await setRsvp(member("D").client, matchId, "out");
    expect(await action(sean, groupId)).toBe("review_dropout");
  });

  it("asks for the result once a match with published Teams has started", async () => {
    const { sean, groupId, member } = await league(["A", "B"], 2);
    const matchId = await createMatch(sean, groupId, { startsAt: inHours(-1), capacity: 2 });
    await openRsvps(sean, matchId);
    for (const n of ["A", "B"]) await setRsvp(member(n).client, matchId, "in");
    await generateDraftTeams(sean, matchId);
    await publishTeams(sean, matchId);

    expect(await action(sean, groupId)).toBe("record_result");

    await recordResult(sean, matchId, { scoreA: 1, scoreB: 0 });
    expect((await getNextMatchView(sean, groupId)).match).toBeNull();
  });

  it("counts claims waiting for confirmation", async () => {
    const { sean, groupId, token } = await league([]);
    const ghost = await addGhost(sean, groupId, "Dave");
    await joinGroup(await newUser(), token, { name: "Dave", claim: ghost });
    await createMatch(sean, groupId, { startsAt: inHours(48) });

    expect((await getNextMatchView(sean, groupId)).admin?.pendingClaims).toBe(1);
  });
});

describe("Teams on the next match", () => {
  it("hides a draft from players and shows a published side, marking mine", async () => {
    const { sean, groupId, member } = await league(["A", "B"], 2);
    const matchId = await createMatch(sean, groupId, { startsAt: inHours(48), capacity: 2 });
    await openRsvps(sean, matchId);
    for (const n of ["A", "B"]) await setRsvp(member(n).client, matchId, "in");
    await generateDraftTeams(sean, matchId);

    expect((await getNextMatchView(member("A").client, groupId)).teams).toBeNull();

    await publishTeams(sean, matchId);
    const view = await getNextMatchView(member("A").client, groupId);
    expect(view.teams?.state).toBe("published");
    expect(["A", "B"]).toContain(view.myTeam);
    const mine = view.myTeam === "A" ? view.teams!.teamA : view.teams!.teamB;
    expect(mine.map((p) => p.displayName)).toContain("A");
  });
});

describe("Several matches", () => {
  it("ignores a match in the far past that never got a result", async () => {
    const { sean, groupId } = await league([]);
    await createMatch(sean, groupId, { startsAt: inHours(-72) });
    const upcoming = await createMatch(sean, groupId, { startsAt: inAWeek() });

    expect((await getNextMatchView(sean, groupId)).match?.id).toBe(upcoming);
  });
});

describe("A match nobody has recorded a result for", () => {
  it("stays in front of an Admin however long ago it was played, but drops out of a player's view", async () => {
    const { sean, groupId, member } = await league(["A", "B"], 2);
    const matchId = await createMatch(sean, groupId, { startsAt: inHours(-72), capacity: 2 });
    await openRsvps(sean, matchId);
    for (const n of ["A", "B"]) await setRsvp(member(n).client, matchId, "in");
    await generateDraftTeams(sean, matchId);
    await publishTeams(sean, matchId);

    const forAdmin = await getNextMatchView(sean, groupId);
    expect(forAdmin.match?.id).toBe(matchId);
    expect(forAdmin.admin?.nextAction).toBe("record_result");
    expect((await getNextMatchView(member("A").client, groupId)).match).toBeNull();
  });
});
