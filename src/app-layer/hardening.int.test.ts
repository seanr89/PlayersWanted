import { describe, expect, it } from "vitest";
import {
  addGhost,
  createGroup,
  createMatch,
  generateDraftTeams,
  getInvite,
  getInviteToken,
  getMatchRsvps,
  getSquad,
  getTeams,
  joinGroup,
  openRsvps,
  publishTeams,
  regenerateInvite,
  rejectClaim,
  setHappyInGoal,
  setPosition,
  setRsvp,
} from "./index";
import { newUser } from "./test-support";

const inAWeek = () => new Date(Date.now() + 7 * 24 * 3600 * 1000);

async function setup() {
  const sean = await newUser();
  const groupId = await createGroup(sean, { name: "Thursday", ownerName: "Sean" });
  const token = await getInviteToken(sean, groupId);
  return { sean, groupId, token };
}

describe("happy-in-goal permissions", () => {
  it("stops a stranger changing a ghost profile's flag", async () => {
    const { sean, groupId } = await setup();
    const ghost = await addGhost(sean, groupId, "Dave");

    await expect(setHappyInGoal(await newUser(), ghost, true)).rejects.toThrow(/not allowed/);

    expect((await getSquad(sean, groupId)).find((m) => m.id === ghost)?.happyInGoal).toBe(false);
  });

  it("stops a member changing another member's flag, but lets them change their own", async () => {
    const { sean, groupId, token } = await setup();
    const priya = await newUser();
    const priyaId = await joinGroup(priya, token, { name: "Priya" });
    const mo = await newUser();
    const moId = await joinGroup(mo, token, { name: "Mo" });

    await expect(setHappyInGoal(priya, moId, true)).rejects.toThrow(/not allowed/);
    await setHappyInGoal(priya, priyaId, true);

    const squad = await getSquad(sean, groupId);
    expect(squad.find((m) => m.id === priyaId)?.happyInGoal).toBe(true);
    expect(squad.find((m) => m.id === moId)?.happyInGoal).toBe(false);
  });
});

describe("position tags", () => {
  it("lets an Admin set a position tag, and nobody else", async () => {
    const { sean, groupId, token } = await setup();
    const priya = await newUser();
    const priyaId = await joinGroup(priya, token, { name: "Priya" });

    await setPosition(sean, priyaId, "defender");

    expect((await getSquad(priya, groupId)).find((m) => m.id === priyaId)?.position).toBe("defender");
    await expect(setPosition(priya, priyaId, "attacker")).rejects.toThrow(/only an admin/);
  });
});

describe("invite links", () => {
  it("stops working once an Admin regenerates it", async () => {
    const { sean, groupId, token } = await setup();

    const fresh = await regenerateInvite(sean, groupId);

    expect(fresh).not.toBe(token);
    await expect(getInvite(await newUser(), token)).rejects.toThrow(/invalid invite/);
    expect((await getInvite(await newUser(), fresh)).groupName).toBe("Thursday");
  });

  it("is for Admins only", async () => {
    const { groupId, token } = await setup();
    const priya = await newUser();
    await joinGroup(priya, token, { name: "Priya" });

    await expect(regenerateInvite(priya, groupId)).rejects.toThrow(/only an admin/);
  });
});

describe("rejected claims", () => {
  it("undo what the wrong claimant did to the ghost profile", async () => {
    const { sean, groupId, token } = await setup();
    const ghost = await addGhost(sean, groupId, "Dave");
    const matchId = await createMatch(sean, groupId, { startsAt: inAWeek() });
    await openRsvps(sean, matchId);
    const imposter = await newUser();
    await joinGroup(imposter, token, { name: "Dave", claim: ghost });
    await setRsvp(imposter, matchId, "in");
    await setHappyInGoal(imposter, ghost, true);

    await rejectClaim(sean, ghost);

    expect(await getMatchRsvps(sean, matchId)).toEqual([]);
    expect((await getSquad(sean, groupId)).find((m) => m.id === ghost)?.happyInGoal).toBe(false);
  });
});

describe("Teams and the match lifecycle", () => {
  async function publishedMatch() {
    const { sean, groupId, token } = await setup();
    const matchId = await createMatch(sean, groupId, { startsAt: inAWeek(), capacity: 2 });
    await openRsvps(sean, matchId);
    const players: Record<string, { client: Awaited<ReturnType<typeof newUser>>; id: string }> = {};
    for (const name of ["A", "B", "C"]) {
      const client = await newUser();
      players[name] = { client, id: await joinGroup(client, token, { name }) };
      await setRsvp(client, matchId, "in");
    }
    await generateDraftTeams(sean, matchId);
    await publishTeams(sean, matchId);
    return { sean, matchId, players, token };
  }

  it("does not silently promote the Waitlist after Teams are published", async () => {
    const { sean, matchId, players } = await publishedMatch();
    const before = await getTeams(sean, matchId);

    await setRsvp(players.A!.client, matchId, "out");

    const rsvps = Object.fromEntries((await getMatchRsvps(sean, matchId)).map((r) => [r.displayName, r]));
    expect(rsvps.A).toMatchObject({ status: "out" });
    expect(rsvps.C).toMatchObject({ status: "waitlist", waitlistPosition: 1 });
    expect(await getTeams(sean, matchId)).toEqual(before);
  });

  it("puts a newcomer's 'in' after publishing on the Waitlist, behind anyone already queued", async () => {
    const { sean, matchId, token } = await publishedMatch();
    const dave = await newUser();
    await joinGroup(dave, token, { name: "Dave" });

    await setRsvp(dave, matchId, "in");

    const rsvps = Object.fromEntries((await getMatchRsvps(sean, matchId)).map((r) => [r.displayName, r]));
    expect(rsvps.C).toMatchObject({ status: "waitlist", waitlistPosition: 1 });
    expect(rsvps.Dave).toMatchObject({ status: "waitlist", waitlistPosition: 2 });
  });

  it("lets a player who dropped out of published Teams take their own place back", async () => {
    const { sean, matchId, players } = await publishedMatch();
    await setRsvp(players.A!.client, matchId, "out");
    await setRsvp(players.A!.client, matchId, "in");

    const rsvps = Object.fromEntries((await getMatchRsvps(sean, matchId)).map((r) => [r.displayName, r]));
    expect(rsvps.A?.status).toBe("playing");
  });

  it("refuses to make a draft before RSVPs are open", async () => {
    const { sean, groupId } = await setup();
    const matchId = await createMatch(sean, groupId, { startsAt: inAWeek() });
    await setRsvp(sean, matchId, "in").catch(() => undefined);

    await expect(generateDraftTeams(sean, matchId)).rejects.toThrow();
    expect(await getTeams(sean, matchId)).toBeNull();
  });

  it("refuses to publish a draft that no longer matches who is playing", async () => {
    const { sean, groupId, token } = await setup();
    const matchId = await createMatch(sean, groupId, { startsAt: inAWeek() });
    await openRsvps(sean, matchId);
    const clients = [];
    for (const name of ["A", "B", "C"]) {
      const client = await newUser();
      await joinGroup(client, token, { name });
      await setRsvp(client, matchId, "in");
      clients.push(client);
    }
    await generateDraftTeams(sean, matchId);

    await setRsvp(clients[0]!, matchId, "out");

    await expect(publishTeams(sean, matchId)).rejects.toThrow(/out of date/);
  });
});

describe("input limits", () => {
  it("rejects absurdly long names", async () => {
    const sean = await newUser();
    await expect(createGroup(sean, { name: "x".repeat(500), ownerName: "Sean" })).rejects.toThrow();
  });
});
