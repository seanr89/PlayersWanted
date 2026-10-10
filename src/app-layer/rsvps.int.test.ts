import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  addGhost,
  createGroup,
  createMatch,
  getInviteToken,
  getMatch,
  getMatchRsvps,
  getMatches,
  joinGroup,
  openRsvps,
  setRsvp,
} from "./index";
import { newUser } from "./test-support";

const inAWeek = () => new Date(Date.now() + 7 * 24 * 3600 * 1000);

/** A Group where Sean organises and `names` have joined as ordinary players. */
async function group(names: string[] = []) {
  const sean = await newUser();
  const groupId = await createGroup(sean, { name: "Thursday", ownerName: "Sean" });
  const token = await getInviteToken(sean, groupId);
  const players: Record<string, { client: SupabaseClient; membershipId: string }> = {};
  for (const name of names) {
    const client = await newUser();
    players[name] = { client, membershipId: await joinGroup(client, token, { name }) };
  }
  return { sean, groupId, token, players };
}

async function openMatch(sean: SupabaseClient, groupId: string, extra: { capacity?: number; rsvpDeadline?: Date } = {}) {
  const matchId = await createMatch(sean, groupId, { startsAt: inAWeek(), ...extra });
  await openRsvps(sean, matchId);
  return matchId;
}

describe("Creating a Match", () => {
  it("defaults Capacity to 10 and starts as scheduled", async () => {
    const { sean, groupId } = await group();

    const matchId = await createMatch(sean, groupId, { startsAt: inAWeek(), costPerPlayer: 4.5 });

    expect(await getMatch(sean, matchId)).toMatchObject({ capacity: 10, costPerPlayer: 4.5, status: "scheduled" });
  });

  it("is for Admins only, and only members can see the Group's Matches", async () => {
    const { sean, groupId, players } = await group(["Priya"]);
    const matchId = await createMatch(sean, groupId, { startsAt: inAWeek() });

    await expect(createMatch(players.Priya!.client, groupId, { startsAt: inAWeek() })).rejects.toThrow();
    expect((await getMatches(players.Priya!.client, groupId)).map((m) => m.id)).toEqual([matchId]);
    expect(await getMatches(await newUser(), groupId)).toEqual([]);
  });
});

describe("RSVPs and Capacity", () => {
  it("does not accept RSVPs until they are opened", async () => {
    const { sean, groupId, players } = await group(["Priya"]);
    const matchId = await createMatch(sean, groupId, { startsAt: inAWeek() });

    await expect(setRsvp(players.Priya!.client, matchId, "in")).rejects.toThrow();

    await openRsvps(sean, matchId);
    await setRsvp(players.Priya!.client, matchId, "in");
    expect((await getMatch(sean, matchId)).status).toBe("rsvps_open");
  });

  it("counts an 'in' as playing and shows the spots left", async () => {
    const { sean, groupId, players } = await group(["Priya", "Mo"]);
    const matchId = await openMatch(sean, groupId, { capacity: 3 });

    await setRsvp(players.Priya!.client, matchId, "in");
    await setRsvp(players.Mo!.client, matchId, "out");

    const rsvps = await getMatchRsvps(sean, matchId);
    expect(rsvps.find((r) => r.displayName === "Priya")).toMatchObject({ response: "in", status: "playing" });
    expect(rsvps.find((r) => r.displayName === "Mo")).toMatchObject({ response: "out", status: "out" });
    expect(await getMatch(sean, matchId)).toMatchObject({ playing: 1, spotsLeft: 2 });
  });

  it("puts an in-RSVP beyond Capacity on the Waitlist, in order of response", async () => {
    const { sean, groupId, players } = await group(["A", "B", "C", "D"]);
    const matchId = await openMatch(sean, groupId, { capacity: 2 });

    for (const name of ["A", "B", "C", "D"]) await setRsvp(players[name]!.client, matchId, "in");

    const byName = Object.fromEntries((await getMatchRsvps(sean, matchId)).map((r) => [r.displayName, r]));
    expect(byName.A).toMatchObject({ status: "playing" });
    expect(byName.B).toMatchObject({ status: "playing" });
    expect(byName.C).toMatchObject({ status: "waitlist", waitlistPosition: 1 });
    expect(byName.D).toMatchObject({ status: "waitlist", waitlistPosition: 2 });
    expect(await getMatch(sean, matchId)).toMatchObject({ playing: 2, spotsLeft: 0, waitlisted: 2 });
  });

  it("promotes the first waitlisted player automatically when a playing player drops out", async () => {
    const { sean, groupId, players } = await group(["A", "B", "C", "D"]);
    const matchId = await openMatch(sean, groupId, { capacity: 2 });
    for (const name of ["A", "B", "C", "D"]) await setRsvp(players[name]!.client, matchId, "in");

    await setRsvp(players.A!.client, matchId, "out");

    const byName = Object.fromEntries((await getMatchRsvps(sean, matchId)).map((r) => [r.displayName, r]));
    expect(byName.C).toMatchObject({ status: "playing" });
    expect(byName.D).toMatchObject({ status: "waitlist", waitlistPosition: 1 });
  });

  it("sends someone who changes their mind back in to the end of the queue", async () => {
    const { sean, groupId, players } = await group(["A", "B", "C"]);
    const matchId = await openMatch(sean, groupId, { capacity: 2 });
    for (const name of ["A", "B", "C"]) await setRsvp(players[name]!.client, matchId, "in");

    await setRsvp(players.A!.client, matchId, "out");
    await setRsvp(players.A!.client, matchId, "in");

    const byName = Object.fromEntries((await getMatchRsvps(sean, matchId)).map((r) => [r.displayName, r]));
    expect(byName.C).toMatchObject({ status: "playing" });
    expect(byName.A).toMatchObject({ status: "waitlist", waitlistPosition: 1 });
  });

  it("keeps your place when you tap 'in' twice", async () => {
    const { sean, groupId, players } = await group(["A", "B"]);
    const matchId = await openMatch(sean, groupId, { capacity: 1 });
    await setRsvp(players.A!.client, matchId, "in");
    await setRsvp(players.B!.client, matchId, "in");

    await setRsvp(players.A!.client, matchId, "in");

    const byName = Object.fromEntries((await getMatchRsvps(sean, matchId)).map((r) => [r.displayName, r]));
    expect(byName.A).toMatchObject({ status: "playing" });
  });
});

describe("Late dropouts", () => {
  it("flags an in-to-out change after the RSVP deadline, visible to Admins only", async () => {
    const { sean, groupId, players } = await group(["Priya"]);
    const matchId = await openMatch(sean, groupId, { rsvpDeadline: new Date(Date.now() - 60_000) });
    await setRsvp(players.Priya!.client, matchId, "in");

    await setRsvp(players.Priya!.client, matchId, "out");

    const forAdmin = await getMatchRsvps(sean, matchId);
    expect(forAdmin.find((r) => r.displayName === "Priya")?.lateDropout).toBe(true);
    const forPlayer = await getMatchRsvps(players.Priya!.client, matchId);
    expect(forPlayer.find((r) => r.displayName === "Priya")).not.toHaveProperty("lateDropout");
  });

  it("does not flag a dropout before the deadline", async () => {
    const { sean, groupId, players } = await group(["Priya"]);
    const matchId = await openMatch(sean, groupId, { rsvpDeadline: new Date(Date.now() + 3600_000) });
    await setRsvp(players.Priya!.client, matchId, "in");

    await setRsvp(players.Priya!.client, matchId, "out");

    expect((await getMatchRsvps(sean, matchId)).find((r) => r.displayName === "Priya")?.lateDropout).toBe(false);
  });
});

describe("Who can RSVP", () => {
  it("lets an Admin RSVP on behalf of a ghost profile", async () => {
    const { sean, groupId } = await group();
    const dave = await addGhost(sean, groupId, "Dave");
    const matchId = await openMatch(sean, groupId);

    await setRsvp(sean, matchId, "in", { onBehalfOf: dave });

    expect((await getMatchRsvps(sean, matchId)).find((r) => r.displayName === "Dave")?.status).toBe("playing");
  });

  it("stops a player RSVPing for someone else", async () => {
    const { sean, groupId, players } = await group(["Priya", "Mo"]);
    const matchId = await openMatch(sean, groupId);

    await expect(
      setRsvp(players.Priya!.client, matchId, "out", { onBehalfOf: players.Mo!.membershipId }),
    ).rejects.toThrow();
  });

  it("lets a player with an unconfirmed claim RSVP", async () => {
    const { sean, groupId, token } = await group();
    const ghost = await addGhost(sean, groupId, "Dave");
    const dave = await newUser();
    await joinGroup(dave, token, { name: "Dave", claim: ghost });
    const matchId = await openMatch(sean, groupId);

    await setRsvp(dave, matchId, "in");

    expect((await getMatchRsvps(sean, matchId)).find((r) => r.displayName === "Dave")?.status).toBe("playing");
  });

  it("stops someone outside the Group from RSVPing or seeing who is in", async () => {
    const { sean, groupId } = await group();
    const matchId = await openMatch(sean, groupId);
    const stranger = await newUser();

    await expect(setRsvp(stranger, matchId, "in")).rejects.toThrow();
    expect(await getMatchRsvps(stranger, matchId)).toEqual([]);
  });
});
