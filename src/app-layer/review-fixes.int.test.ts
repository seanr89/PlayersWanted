import { describe, expect, it } from "vitest";
import {
  addGhost,
  confirmClaim,
  createGroup,
  createMatch,
  dismissFix,
  generateDraftTeams,
  getAttendanceBoard,
  getInviteToken,
  getMatch,
  getOwnRecord,
  getProposedFix,
  joinGroup,
  openRsvps,
  publishTeams,
  recordResult,
  rejectClaim,
  setRating,
  setRsvp,
  updateMatch,
} from "./index";
import { inAWeek, newUser } from "./test-support";

const anHourAgo = () => new Date(Date.now() - 3600_000);

/** Sean's group with four rated ghosts (G1..G4) who have all played a Match that has been given a Result. */
async function groupWithPlayedMatch() {
  const sean = await newUser();
  const groupId = await createGroup(sean, { name: "Thursday", ownerName: "Sean" });
  const token = await getInviteToken(sean, groupId);
  const ids: Record<string, string> = {};
  for (const name of ["G1", "G2", "G3", "G4"]) {
    ids[name] = await addGhost(sean, groupId, name);
    await setRating(sean, ids[name], 50);
  }
  const matchId = await createMatch(sean, groupId, { startsAt: anHourAgo(), capacity: 4 });
  await openRsvps(sean, matchId);
  for (const id of Object.values(ids)) await setRsvp(sean, matchId, "in", { onBehalfOf: id });
  await generateDraftTeams(sean, matchId);
  await publishTeams(sean, matchId);
  await recordResult(sean, matchId, { scoreA: 3, scoreB: 2 });
  return { sean, groupId, token, ids, matchId };
}

const playedBy = async (client: Awaited<ReturnType<typeof newUser>>, groupId: string, name: string) =>
  (await getAttendanceBoard(client, groupId)).find((r) => r.displayName === name)?.played;

describe("Claims on profiles that have already played", () => {
  it("keeps a ghost's played history when a wrong claim is rejected", async () => {
    const { sean, groupId, token, ids } = await groupWithPlayedMatch();
    const imposter = await newUser();
    await joinGroup(imposter, token, { name: "G1", claim: ids.G1! });
    expect(await playedBy(sean, groupId, "G1")).toBe(1);

    await rejectClaim(sean, ids.G1!);

    expect(await playedBy(sean, groupId, "G1")).toBe(1);
  });

  it("does not show a pending claimant the profile's record until an Admin confirms", async () => {
    const { sean, groupId, token, ids } = await groupWithPlayedMatch();
    const claimer = await newUser();
    await joinGroup(claimer, token, { name: "G1", claim: ids.G1! });

    expect(await getOwnRecord(claimer, groupId)).toMatchObject({ played: 0, groupMatches: 0 });

    await confirmClaim(sean, ids.G1!);
    expect(await getOwnRecord(claimer, groupId)).toMatchObject({ played: 1 });
  });
});

describe("Own record: groupMatches", () => {
  it("only counts Matches created after you joined, so newcomers are not penalised", async () => {
    const { groupId, token } = await groupWithPlayedMatch();
    const newcomer = await newUser();
    await joinGroup(newcomer, token, { name: "Newcomer" });

    expect(await getOwnRecord(newcomer, groupId)).toMatchObject({ played: 0, groupMatches: 0 });
  });
});

describe("Clearing the RSVP deadline", () => {
  it("lets an Admin remove a deadline, while leaving it alone when not mentioned", async () => {
    const sean = await newUser();
    const groupId = await createGroup(sean, { name: "Thursday", ownerName: "Sean" });
    const matchId = await createMatch(sean, groupId, { startsAt: inAWeek(), rsvpDeadline: new Date(Date.now() + 3600_000) });

    await updateMatch(sean, matchId, { costPerPlayer: 3 });
    expect((await getMatch(sean, matchId)).rsvpDeadline).not.toBeNull();

    await updateMatch(sean, matchId, { rsvpDeadline: null });
    expect((await getMatch(sean, matchId)).rsvpDeadline).toBeNull();
  });
});

describe("Recording a Result at the right time", () => {
  async function publishedFuture() {
    const sean = await newUser();
    const groupId = await createGroup(sean, { name: "Thursday", ownerName: "Sean" });
    const matchId = await createMatch(sean, groupId, { startsAt: inAWeek(), capacity: 2 });
    await openRsvps(sean, matchId);
    const ids: string[] = [];
    for (const name of ["A", "B"]) {
      const id = await addGhost(sean, groupId, name);
      await setRating(sean, id, 50);
      await setRsvp(sean, matchId, "in", { onBehalfOf: id });
      ids.push(id);
    }
    await generateDraftTeams(sean, matchId);
    await publishTeams(sean, matchId);
    return { sean, matchId, ids };
  }

  it("refuses a Result before the Match has started", async () => {
    const { sean, matchId } = await publishedFuture();

    await expect(recordResult(sean, matchId, { scoreA: 1, scoreB: 0 })).rejects.toThrow(/before the match has started/);
  });

  it("makes the Admin deal with an unresolved dropout first, by confirming or dismissing the fix", async () => {
    const sean = await newUser();
    const groupId = await createGroup(sean, { name: "Thursday", ownerName: "Sean" });
    const matchId = await createMatch(sean, groupId, { startsAt: anHourAgo(), capacity: 4 });
    await openRsvps(sean, matchId);
    const ids: string[] = [];
    for (const name of ["A", "B", "C", "D"]) {
      const id = await addGhost(sean, groupId, name);
      await setRating(sean, id, 50);
      await setRsvp(sean, matchId, "in", { onBehalfOf: id });
      ids.push(id);
    }
    await generateDraftTeams(sean, matchId);
    await publishTeams(sean, matchId);
    await setRsvp(sean, matchId, "out", { onBehalfOf: ids[3]! });

    await expect(recordResult(sean, matchId, { scoreA: 1, scoreB: 0 })).rejects.toThrow(/dropped out/);

    await dismissFix(sean, matchId, (await getProposedFix(sean, matchId))!);
    await recordResult(sean, matchId, { scoreA: 1, scoreB: 0 });
    expect((await getMatch(sean, matchId)).status).toBe("played");
  });
});
