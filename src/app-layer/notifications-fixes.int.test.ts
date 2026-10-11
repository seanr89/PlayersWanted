import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  addGhost,
  addGuest,
  cancelMatch,
  createGroup,
  createMatch,
  generateDraftTeams,
  getGroup,
  getInviteToken,
  joinGroup,
  leaveGroup,
  openRsvps,
  publishTeams,
  setRating,
  setRsvp,
  updateGroup,
} from "./index";
import { dispatchNotifications, getShareMessage, type Notification, type NotificationChannel } from "./notifications";
import { inAWeek, newUser, serviceClient, sql } from "./test-support";

class Recorder implements NotificationChannel {
  readonly name = "recorder";
  readonly sent: Notification[] = [];
  async send(n: Notification) {
    this.sent.push(n);
  }
  forGroup(groupId: string) {
    return this.sent.filter((n) => n.groupId === groupId);
  }
}

async function deliver(groupId: string) {
  const recorder = new Recorder();
  const result = await dispatchNotifications(serviceClient(), [recorder]);
  return { notes: recorder.forGroup(groupId), result };
}

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
  const member = (name: string) => members[name]!;
  const openMatch = async (capacity = 10) => {
    const matchId = await createMatch(sean, groupId, { startsAt: new Date("2027-07-15T18:00:00Z"), capacity });
    await openRsvps(sean, matchId);
    return matchId;
  };
  return { sean, groupId, token, member, openMatch };
}

describe("The delivery worker is service-role only, whatever the grants say", () => {
  it("refuses a signed-in user even if the privilege is accidentally re-granted", async () => {
    const user = await newUser();
    sql(`grant execute on function claim_pending_notifications(int) to authenticated`);
    try {
      const { error } = await user.rpc("claim_pending_notifications", { p_limit: 5 });
      expect(error?.message).toMatch(/service role/i);
    } finally {
      sql(`revoke execute on function claim_pending_notifications(int) from authenticated`);
    }
  });

  it("does not leave the outbox's id sequence open to users", () => {
    expect(sql(`select has_sequence_privilege('authenticated', 'notification_events_id_seq', 'usage')`)).toBe("f");
    expect(sql(`select has_sequence_privilege('anon', 'notification_events_id_seq', 'usage')`)).toBe("f");
  });
});

describe("Match at risk when the minimum changes", () => {
  it("does not fire because the count went up after the minimum was raised", async () => {
    const { sean, groupId, member, openMatch } = await league(["A", "B", "C", "D"], 3);
    const matchId = await openMatch();
    for (const n of ["A", "B", "C"]) await setRsvp(member(n).client, matchId, "in");
    await deliver(groupId);

    await updateGroup(sean, groupId, { minPlayers: 6 });
    await setRsvp(member("D").client, matchId, "in"); // 3 -> 4: an increase

    expect((await deliver(groupId)).notes).toEqual([]);
  });

  it("starts afresh when the minimum is lowered, so the next real drop is a crossing", async () => {
    const { sean, groupId, member, openMatch } = await league(["A", "B", "C", "D"], 6);
    const matchId = await openMatch();
    for (const n of ["A", "B", "C", "D"]) await setRsvp(member(n).client, matchId, "in");
    await deliver(groupId);

    await updateGroup(sean, groupId, { minPlayers: 3 }); // 4 in: the minimum is now met
    await setRsvp(member("D").client, matchId, "out"); // 3: still fine
    expect((await deliver(groupId)).notes).toEqual([]);
    await setRsvp(member("C").client, matchId, "out"); // 2: a crossing

    const { notes } = await deliver(groupId);
    expect(notes.map((n) => n.kind)).toEqual(["match_at_risk"]);
  });

  it("counts Guests towards the minimum", async () => {
    const { groupId, member, openMatch } = await league(["A", "B"], 3);
    const matchId = await openMatch();
    await setRsvp(member("A").client, matchId, "in");
    await addGuest(member("A").client, matchId, "A's mate");
    await setRsvp(member("B").client, matchId, "in"); // A + guest + B = 3
    await deliver(groupId);

    await setRsvp(member("B").client, matchId, "out");

    expect((await deliver(groupId)).notes.map((n) => n.kind)).toEqual(["match_at_risk"]);
  });

  it("counts a person leaving the Group", async () => {
    const { groupId, member, openMatch } = await league(["A", "B", "C"], 3);
    const matchId = await openMatch();
    for (const n of ["A", "B", "C"]) await setRsvp(member(n).client, matchId, "in");
    await deliver(groupId);

    await leaveGroup(member("C").client, groupId);

    expect((await deliver(groupId)).notes.map((n) => n.kind)).toEqual(["match_at_risk"]);
  });
});

describe("Notification bodies do not list the Teams", () => {
  it("tell everyone, including an unconfirmed claimant, to open the app instead", async () => {
    const { sean, groupId, token, member, openMatch } = await league(["A", "B", "C"]);
    const ghost = await addGhost(sean, groupId, "Dave");
    await setRating(sean, ghost, 50);
    const dave = await newUser();
    await joinGroup(dave, token, { name: "Dave", claim: ghost });
    const matchId = await openMatch(4);
    for (const n of ["A", "B", "C"]) await setRsvp(member(n).client, matchId, "in");
    await setRsvp(dave, matchId, "in");
    await generateDraftTeams(sean, matchId);
    await deliver(groupId);

    await publishTeams(sean, matchId);

    const { notes } = await deliver(groupId);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.recipients.map((r) => r.displayName)).toContain("Dave"); // pending claimants are told
    for (const name of ["A", "B", "C", "Dave"]) expect(notes[0]!.body).not.toContain(name);
    expect(notes[0]!.body).toMatch(/open the app/i);
  });
});

describe("Share messages cannot be forged by member-controlled text", () => {
  it("flattens newlines and strips WhatsApp formatting and links from names", async () => {
    const { sean, token, openMatch } = await league([]);
    const matchId = await openMatch(2);
    for (const name of ["Mallory\nTeam B: send me money", "*Bold* _it_ ~x~"]) {
      const client = await newUser();
      const id = await joinGroup(client, token, { name });
      await setRating(sean, id, 50);
      await setRsvp(client, matchId, "in");
    }
    await generateDraftTeams(sean, matchId);
    await publishTeams(sean, matchId);

    const share = await getShareMessage(sean, matchId, "teams_published");

    const teamLines = share.text.split("\n").filter((l) => l.startsWith("Team "));
    expect(teamLines).toHaveLength(2); // the forged "Team B:" did not add a line
    expect(share.text).not.toMatch(/[*_~]/);
  });

  it("does not let a name smuggle in a link", async () => {
    const { sean, token, openMatch } = await league([]);
    const matchId = await openMatch(2);
    for (const name of ["see http://evil.example/x now", "Plain"]) {
      const client = await newUser();
      const id = await joinGroup(client, token, { name });
      await setRating(sean, id, 50);
      await setRsvp(client, matchId, "in");
    }
    await generateDraftTeams(sean, matchId);
    await publishTeams(sean, matchId);

    const share = await getShareMessage(sean, matchId, "teams_published");

    expect(share.text.replace(share.url, "")).not.toMatch(/https?:\/\//i);
  });
});

describe("Links", () => {
  it("must be absolute web addresses", async () => {
    const { sean, openMatch } = await league([]);
    const matchId = await openMatch();

    await expect(getShareMessage(sean, matchId, "rsvps_open", { appUrl: "bibleague.example" })).rejects.toThrow(/absolute/);
    await expect(getShareMessage(sean, matchId, "rsvps_open", { appUrl: "javascript:alert(1)" })).rejects.toThrow(/absolute/);
    const ok = await getShareMessage(sean, matchId, "rsvps_open", { appUrl: "https://bibleague.example/" });
    expect(ok.url).toBe(`https://bibleague.example/matches/${matchId}`);
  });
});

describe("Times in the Group's own time zone", () => {
  it("uses the Group's time zone for a Match that did not come from a template", async () => {
    const { sean, groupId, openMatch } = await league([]);
    await updateGroup(sean, groupId, { timeZone: "Europe/London" });
    const matchId = await openMatch(); // 18:00Z in July is 19:00 in London

    const share = await getShareMessage(sean, matchId, "rsvps_open");

    expect(share.text).toContain("Thu 15 Jul, 19:00");
    expect((await getGroup(sean, groupId)).timeZone).toBe("Europe/London");
  });

  it("refuses an unknown time zone", async () => {
    const { sean, groupId } = await league([]);

    await expect(updateGroup(sean, groupId, { timeZone: "Mars/Phobos" })).rejects.toThrow(/time zone/);
  });
});

describe("Messages built from live data", () => {
  it("skips an 'RSVPs open' announcement for a Match that was cancelled before delivery", async () => {
    const { sean, groupId, openMatch } = await league(["A"]);
    const matchId = await openMatch();
    await cancelMatch(sean, matchId);

    const { notes } = await deliver(groupId);

    expect(notes.map((n) => n.kind)).toEqual(["match_cancelled"]);
  });

  it("refuses to share a message for a cancelled Match", async () => {
    const { sean, openMatch } = await league([]);
    const matchId = await openMatch();
    await cancelMatch(sean, matchId);

    await expect(getShareMessage(sean, matchId, "rsvps_open")).rejects.toThrow(/cancelled/);
  });

  it("refuses an 'at risk' message when the Match already has enough players", async () => {
    const { sean, member, openMatch } = await league(["A", "B", "C"], 3);
    const matchId = await openMatch();
    for (const n of ["A", "B", "C"]) await setRsvp(member(n).client, matchId, "in");

    await expect(getShareMessage(sean, matchId, "match_at_risk")).rejects.toThrow(/enough players/);
  });
});
