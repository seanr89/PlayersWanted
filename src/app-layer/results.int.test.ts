import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  addGuest,
  createGroup,
  createMatch,
  generateDraftTeams,
  getAttendanceBoard,
  getInviteToken,
  getMatch,
  getOwnRecord,
  getResult,
  getTeams,
  joinGroup,
  openRsvps,
  publishTeams,
  recordResult,
  setRating,
  setRsvp,
} from "./index";
import { inAWeek, newUser } from "./test-support";

interface Player {
  client: SupabaseClient;
  id: string;
}

/** Sean organises a group. `names` join, get rated 50 and are RSVPed in for each Match made with `playMatch`. */
async function league(names: string[]) {
  const sean = await newUser();
  const groupId = await createGroup(sean, { name: "Thursday", ownerName: "Sean" });
  const token = await getInviteToken(sean, groupId);
  const players: Record<string, Player> = {};
  for (const name of names) {
    const client = await newUser();
    const id = await joinGroup(client, token, { name });
    await setRating(sean, id, 50);
    players[name] = { client, id };
  }

  async function publishedMatch(playing = names) {
    const matchId = await createMatch(sean, groupId, { startsAt: inAWeek(), capacity: playing.length });
    await openRsvps(sean, matchId);
    for (const name of playing) await setRsvp(players[name]!.client, matchId, "in");
    await generateDraftTeams(sean, matchId);
    await publishTeams(sean, matchId);
    return matchId;
  }
  return { sean, groupId, players, publishedMatch };
}

const sideOf = async (client: SupabaseClient, matchId: string, name: string) => {
  const teams = (await getTeams(client, matchId))!;
  return teams.teamA.some((p) => p.displayName === name) ? "A" : "B";
};

describe("Recording a Result", () => {
  it("stores one score per Team and marks the Match played", async () => {
    const { sean, publishedMatch } = await league(["A", "B", "C", "D"]);
    const matchId = await publishedMatch();

    await recordResult(sean, matchId, { scoreA: 6, scoreB: 4 });

    expect(await getResult(sean, matchId)).toMatchObject({ scoreA: 6, scoreB: 4 });
    expect((await getMatch(sean, matchId)).status).toBe("played");
  });

  it("lets an Admin correct a mistyped score", async () => {
    const { sean, publishedMatch } = await league(["A", "B"]);
    const matchId = await publishedMatch();
    await recordResult(sean, matchId, { scoreA: 6, scoreB: 4 });

    await recordResult(sean, matchId, { scoreA: 6, scoreB: 5 });

    expect(await getResult(sean, matchId)).toMatchObject({ scoreA: 6, scoreB: 5 });
  });

  it("needs published Teams, an Admin, and sensible scores", async () => {
    const { sean, groupId, players, publishedMatch } = await league(["A", "B"]);
    const unpublished = await createMatch(sean, groupId, { startsAt: inAWeek() });
    const matchId = await publishedMatch();

    await expect(recordResult(sean, unpublished, { scoreA: 1, scoreB: 0 })).rejects.toThrow(/published teams/);
    await expect(recordResult(players.A!.client, matchId, { scoreA: 1, scoreB: 0 })).rejects.toThrow(/only an admin/);
    await expect(recordResult(sean, matchId, { scoreA: -1, scoreB: 0 })).rejects.toThrow();
    expect(await getResult(sean, matchId)).toBeNull();
  });

  it("is visible to members only", async () => {
    const { sean, players, publishedMatch } = await league(["A", "B"]);
    const matchId = await publishedMatch();
    await recordResult(sean, matchId, { scoreA: 2, scoreB: 1 });

    expect(await getResult(players.A!.client, matchId)).toMatchObject({ scoreA: 2, scoreB: 1 });
    expect(await getResult(await newUser(), matchId)).toBeNull();
  });
});

describe("Own record", () => {
  it("counts played, won, drawn and lost from the Teams you were on", async () => {
    const { sean, groupId, players, publishedMatch } = await league(["A", "B", "C", "D"]);
    const first = await publishedMatch();
    const second = await publishedMatch();
    await recordResult(sean, first, { scoreA: 5, scoreB: 3 });
    await recordResult(sean, second, { scoreA: 2, scoreB: 2 });

    const record = await getOwnRecord(players.A!.client, groupId);

    const wonFirst = (await sideOf(players.A!.client, first, "A")) === "A";
    expect(record).toMatchObject({
      played: 2,
      won: wonFirst ? 1 : 0,
      lost: wonFirst ? 0 : 1,
      drawn: 1,
      groupMatches: 2,
    });
  });

  it("ignores Matches that have not been played, and anyone who dropped out", async () => {
    const { sean, groupId, players, publishedMatch } = await league(["A", "B", "C", "D"]);
    await publishedMatch(); // never played
    const played = await publishedMatch();
    await setRsvp(players.D!.client, played, "out");
    await recordResult(sean, played, { scoreA: 1, scoreB: 0 });

    expect(await getOwnRecord(players.D!.client, groupId)).toMatchObject({ played: 0, won: 0, lost: 0, drawn: 0 });
    expect(await getOwnRecord(players.A!.client, groupId)).toMatchObject({ played: 1, groupMatches: 1 });
  });
});

describe("Attendance board", () => {
  it("shows how many Matches each member played, without ratings or wins", async () => {
    const { sean, groupId, players, publishedMatch } = await league(["A", "B", "C", "D"]);
    const first = await publishedMatch(["A", "B", "C", "D"]);
    await recordResult(sean, first, { scoreA: 3, scoreB: 1 });
    const second = await publishedMatch(["A", "B"]);
    await recordResult(sean, second, { scoreA: 1, scoreB: 1 });

    const board = await getAttendanceBoard(players.C!.client, groupId);

    const played = Object.fromEntries(board.map((row) => [row.displayName, row.played]));
    expect(played).toMatchObject({ A: 2, B: 2, C: 1, D: 1, Sean: 0 });
    expect(board[0]!.played).toBeGreaterThanOrEqual(board[board.length - 1]!.played);
    for (const row of board) expect(Object.keys(row).sort()).toEqual(["displayName", "membershipId", "played"]);
  });

  it("leaves out Guests and non-members", async () => {
    const { sean, groupId, players } = await league(["A", "B"]);
    const matchId = await createMatch(sean, groupId, { startsAt: inAWeek(), capacity: 3 });
    await openRsvps(sean, matchId);
    await setRsvp(players.A!.client, matchId, "in");
    await setRsvp(players.B!.client, matchId, "in");
    await addGuest(players.A!.client, matchId, "A's mate");
    await generateDraftTeams(sean, matchId);
    await publishTeams(sean, matchId);
    await recordResult(sean, matchId, { scoreA: 1, scoreB: 0 });

    const board = await getAttendanceBoard(players.A!.client, groupId);

    expect(board.map((r) => r.displayName)).not.toContain("A's mate");
    expect(await getAttendanceBoard(await newUser(), groupId)).toEqual([]);
  });
});
