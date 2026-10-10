import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  addGhost,
  cancelMatch,
  confirmFix,
  createGroup,
  createMatch,
  createVenue,
  generateDraftTeams,
  getInviteToken,
  getProposedFix,
  joinGroup,
  leaveGroup,
  openRsvps,
  publishTeams,
  saveRecurringTemplate,
  getMatches,
  setRating,
  setRsvp,
  updateGroup,
} from "./index";
import {
  dispatchNotifications,
  getShareMessage,
  type Notification,
  type NotificationChannel,
} from "./notifications";
import { inAWeek, newUser, runRecurringJob, serviceClient, sql } from "./test-support";

const DAY = 24 * 3600_000;

/** Collects what would be sent, standing in for web push, email and the rest. */
class RecordingChannel implements NotificationChannel {
  readonly sent: Notification[] = [];
  constructor(readonly name = "recording") {}
  async send(notification: Notification) {
    this.sent.push(notification);
  }
  forGroup(groupId: string, kind?: Notification["kind"]) {
    return this.sent.filter((n) => n.groupId === groupId && (kind === undefined || n.kind === kind));
  }
}

async function deliver(groupId: string, channel = new RecordingChannel()) {
  await dispatchNotifications(serviceClient(), [channel]);
  return channel.forGroup(groupId);
}

interface Member {
  client: SupabaseClient;
  id: string;
}

/** Sean owns "Thursday"; each name joins as a rated member. */
async function league(names: string[], options: { minPlayers?: number } = {}) {
  const sean = await newUser();
  const groupId = await createGroup(sean, { name: "Thursday", ownerName: "Sean" });
  if (options.minPlayers) await updateGroup(sean, groupId, { minPlayers: options.minPlayers });
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
    const matchId = await createMatch(sean, groupId, { startsAt: inAWeek(), capacity });
    await openRsvps(sean, matchId);
    return matchId;
  };
  return { sean, groupId, token, member, openMatch };
}

const names = (n: Notification) => n.recipients.map((r) => r.displayName).sort();

describe("RSVPs open", () => {
  it("tells every member, with a link to the Match", async () => {
    const { groupId, openMatch } = await league(["Priya", "Mo"]);
    const matchId = await openMatch();

    const [note, ...rest] = await deliver(groupId, new RecordingChannel());

    expect(rest).toEqual([]);
    expect(note).toMatchObject({ kind: "rsvps_opened", matchId, groupName: "Thursday" });
    expect(names(note!)).toEqual(["Mo", "Priya", "Sean"]);
    expect(note!.url).toContain(matchId);
    expect(note!.title).toMatch(/RSVPs are open/i);
  });

  it("is sent when the weekly job opens RSVPs, once", async () => {
    const sean = await newUser();
    const groupId = await createGroup(sean, { name: "Thursday", ownerName: "Sean" });
    await saveRecurringTemplate(sean, groupId, { weekday: 4, startTime: "19:00", timezone: "UTC" });
    const [match] = await getMatches(sean, groupId);
    const kickoff = new Date(match!.startsAt).getTime();

    runRecurringJob(new Date(kickoff - 2 * DAY), groupId);
    expect(await deliver(groupId)).toHaveLength(1);

    runRecurringJob(new Date(kickoff - 2 * DAY + 60_000), groupId);
    expect(await deliver(groupId)).toHaveLength(0);
  });

  it("does not tell ghost profiles, people who have left, or anyone about a Match nobody opened", async () => {
    const { sean, groupId, member, openMatch } = await league(["Priya", "Mo"]);
    await addGhost(sean, groupId, "Dave");
    await leaveGroup(member("Mo").client, groupId);
    await createMatch(sean, groupId, { startsAt: inAWeek() }); // never opened

    await openMatch();

    const notes = await deliver(groupId);
    expect(notes).toHaveLength(1);
    expect(names(notes[0]!)).toEqual(["Priya", "Sean"]);
  });
});

describe("Match at risk", () => {
  it("nudges Admins once per drop below the minimum, and not again within ten minutes", async () => {
    const { groupId, member, openMatch } = await league(["A", "B", "C", "D"], { minPlayers: 3 });
    const matchId = await openMatch();
    await deliver(groupId); // the RSVPs-open announcement

    for (const n of ["A", "B"]) await setRsvp(member(n).client, matchId, "in");
    await setRsvp(member("C").client, matchId, "in"); // 3: the minimum is reached
    expect(await deliver(groupId)).toEqual([]);

    await setRsvp(member("A").client, matchId, "out"); // 2: first crossing
    const first = await deliver(groupId);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ kind: "match_at_risk", matchId });
    expect(names(first[0]!)).toEqual(["Sean"]); // Admins only

    await setRsvp(member("B").client, matchId, "out"); // still below: no repeat
    expect(await deliver(groupId)).toEqual([]);

    for (const n of ["A", "B", "D"]) await setRsvp(member(n).client, matchId, "in"); // C, A, B, D = 4: back above
    expect(await deliver(groupId)).toEqual([]);
    await setRsvp(member("B").client, matchId, "out"); // A, C, D = 3: still at the minimum
    expect(await deliver(groupId)).toEqual([]);
    await setRsvp(member("A").client, matchId, "out"); // C, D = 2: a second crossing, but within the cooldown
    expect(await deliver(groupId)).toEqual([]);
  });

  it("does not nudge about a Match that never reached the minimum", async () => {
    const { groupId, member, openMatch } = await league(["A", "B"], { minPlayers: 5 });
    const matchId = await openMatch();
    await deliver(groupId);

    await setRsvp(member("A").client, matchId, "in");
    await setRsvp(member("B").client, matchId, "in");
    await setRsvp(member("A").client, matchId, "out");

    expect(await deliver(groupId)).toEqual([]);
  });
});

describe("Teams", () => {
  async function published() {
    const l = await league(["A", "B", "C", "D"]);
    const matchId = await l.openMatch(4);
    for (const n of ["A", "B", "C", "D"]) await setRsvp(l.member(n).client, matchId, "in");
    await deliver(l.groupId);
    await generateDraftTeams(l.sean, matchId);
    return { ...l, matchId };
  }

  it("tells every member when Teams are published, but nothing while they are a draft", async () => {
    const { sean, groupId, matchId } = await published();
    expect(await deliver(groupId)).toEqual([]);

    await publishTeams(sean, matchId);

    const [note] = await deliver(groupId);
    expect(note).toMatchObject({ kind: "teams_published", matchId });
    expect(names(note!)).toEqual(["A", "B", "C", "D", "Sean"]);
  });

  it("tells every member when published Teams change after a confirmed fix", async () => {
    const { sean, groupId, matchId, member } = await published();
    await publishTeams(sean, matchId);
    await deliver(groupId);
    await setRsvp(member("D").client, matchId, "out");
    expect(await deliver(groupId)).toEqual([]); // a dropout alone changes nothing

    await confirmFix(sean, matchId, (await getProposedFix(sean, matchId))!);

    const [note] = await deliver(groupId);
    expect(note).toMatchObject({ kind: "teams_changed", matchId, payload: { revision: 1 } });
  });
});

describe("Cancelling", () => {
  it("tells members about a Match they were told about, and nobody about one that was never announced", async () => {
    const { sean, groupId, openMatch } = await league(["A"]);
    const announced = await openMatch();
    const unannounced = await createMatch(sean, groupId, { startsAt: inAWeek() });
    await deliver(groupId);

    await cancelMatch(sean, unannounced);
    expect(await deliver(groupId)).toEqual([]);
    await cancelMatch(sean, announced);

    const [note] = await deliver(groupId);
    expect(note).toMatchObject({ kind: "match_cancelled", matchId: announced });
  });
});

describe("Delivery", () => {
  it("hands each event over once, however often the worker runs", async () => {
    const { groupId, openMatch } = await league(["A"]);
    await openMatch();
    const channel = new RecordingChannel();

    await dispatchNotifications(serviceClient(), [channel]);
    const again = await dispatchNotifications(serviceClient(), [channel]);

    expect(channel.forGroup(groupId)).toHaveLength(1);
    expect(again.delivered).toBe(0);
  });

  it("gives every channel the notification, and one channel failing does not stop the others", async () => {
    const { groupId, openMatch } = await league(["A"]);
    await openMatch();
    const good = new RecordingChannel("email");
    const broken: NotificationChannel = {
      name: "push",
      send: async () => {
        throw new Error("push service is down");
      },
    };

    const result = await dispatchNotifications(serviceClient(), [broken, good]);

    expect(good.forGroup(groupId)).toHaveLength(1);
    expect(result.failures).toContainEqual(
      expect.objectContaining({ channel: "push", error: expect.stringContaining("push service is down") }),
    );
  });

  it("is only available to the service role, never to a signed-in user", async () => {
    const user = await newUser();

    const { error } = await user.rpc("claim_pending_notifications", { p_limit: 5 });

    expect(error).not.toBeNull();
    expect(sql(`select has_function_privilege('authenticated', 'public.claim_pending_notifications(int)', 'execute')`)).toBe("f");
    expect(sql(`select has_function_privilege('anon', 'public.claim_pending_notifications(int)', 'execute')`)).toBe("f");
    expect(sql(`select has_function_privilege('service_role', 'public.claim_pending_notifications(int)', 'execute')`)).toBe("t");
  });

  it("cannot be read by players from the events table", async () => {
    const { member } = await league(["A"]);

    const { data, error } = await member("A").client.from("notification_events").select("*");

    expect(error?.message).toMatch(/permission denied/i);
    expect(data).toBeNull();
  });

  it("carries nobody's Rating, and only the details a channel needs about each recipient", async () => {
    const { groupId, openMatch } = await league(["A"]);
    await openMatch();

    const [note] = await deliver(groupId);

    expect(JSON.stringify(note)).not.toMatch(/rating/i);
    expect(Object.keys(note!.recipients[0]!).sort()).toEqual(["authUserId", "displayName", "isAdmin", "membershipId", "personId"]);
  });
});

describe("WhatsApp share messages", () => {
  async function thursdayAt(startsAt: Date) {
    const l = await league(["A", "B", "C", "D", "E"]);
    const venue = await createVenue(l.sean, l.groupId, { name: "Powerleague", defaultCost: 4.5 });
    const matchId = await createMatch(l.sean, l.groupId, { startsAt, venueId: venue, capacity: 5 });
    await openRsvps(l.sean, matchId);
    return { ...l, matchId };
  }

  it("gives an Admin a prefilled 'RSVPs open' message with the details and a link", async () => {
    const { sean, matchId } = await thursdayAt(new Date("2027-01-14T19:00:00Z"));

    const share = await getShareMessage(sean, matchId, "rsvps_open", { appUrl: "https://bibleague.example" });

    expect(share.text).toContain("Powerleague");
    expect(share.text).toContain("Thu 14 Jan");
    expect(share.text).toContain("19:00");
    expect(share.text).toContain("4.50");
    expect(share.url).toBe(`https://bibleague.example/matches/${matchId}`);
    expect(share.text).toContain(share.url);
    expect(share.whatsappUrl).toBe(`https://wa.me/?text=${encodeURIComponent(share.text)}`);
  });

  it("gives an 'at risk' message that says how many are in and how many more are needed", async () => {
    const { sean, matchId, member } = await thursdayAt(new Date("2027-01-14T19:00:00Z"));
    for (const n of ["A", "B", "C"]) await setRsvp(member(n).client, matchId, "in");

    const share = await getShareMessage(sean, matchId, "match_at_risk");

    expect(share.text).toMatch(/3 in/);
    expect(share.text).toMatch(/need 5 more/i); // the default minimum is 8
  });

  it("lists both Teams in the 'Teams published' message, without any Ratings", async () => {
    const { sean, matchId, member } = await thursdayAt(new Date("2027-01-14T19:00:00Z"));
    const ratings: Record<string, number> = { A: 77, B: 33, C: 58, D: 41, E: 66 };
    for (const [n, r] of Object.entries(ratings)) {
      await setRating(sean, member(n).id, r);
      await setRsvp(member(n).client, matchId, "in");
    }
    await generateDraftTeams(sean, matchId);
    await publishTeams(sean, matchId);

    const share = await getShareMessage(sean, matchId, "teams_published");

    for (const n of Object.keys(ratings)) expect(share.text).toContain(n);
    expect(share.text).toMatch(/Team A/);
    expect(share.text).toMatch(/Team B/);
    expect(share.text.replace(share.url, "")).not.toMatch(/77|33|58|41|66/); // the link holds a random id, so leave it out
  });

  it("refuses players, and refuses to share Teams that are still a draft", async () => {
    const { sean, matchId, member } = await thursdayAt(new Date("2027-01-14T19:00:00Z"));
    for (const n of ["A", "B"]) await setRsvp(member(n).client, matchId, "in");
    await generateDraftTeams(sean, matchId);

    await expect(getShareMessage(member("A").client, matchId, "rsvps_open")).rejects.toThrow(/only an admin/);
    await expect(getShareMessage(sean, matchId, "teams_published")).rejects.toThrow(/published/);
  });
});
