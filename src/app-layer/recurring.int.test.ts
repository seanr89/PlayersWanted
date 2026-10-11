import { describe, expect, it } from "vitest";
import {
  cancelMatch,
  createGroup,
  createMatch,
  createVenue,
  getInviteToken,
  getMatches,
  getRecurringTemplate,
  joinGroup,
  saveRecurringTemplate,
  setRecurringPaused,
  updateMatch,
} from "./index";
import { inAWeek, localTime, newUser, runRecurringJob, sql } from "./test-support";

const HOUR = 3600_000;
const DAY = 24 * HOUR;

async function thursdays(overrides: Partial<Parameters<typeof saveRecurringTemplate>[2]> = {}) {
  const sean = await newUser();
  const groupId = await createGroup(sean, { name: "Thursday 7pm", ownerName: "Sean" });
  const priya = await newUser();
  await joinGroup(priya, await getInviteToken(sean, groupId), { name: "Priya" });
  await saveRecurringTemplate(sean, groupId, {
    weekday: 4,
    startTime: "19:00",
    timezone: "UTC",
    ...overrides,
  });
  const matches = () => getMatches(sean, groupId);
  return { sean, groupId, priya, matches };
}

describe("Saving the weekly template", () => {
  it("creates next week's Match straight away, on the right weekday and time", async () => {
    const { matches } = await thursdays({ timezone: "Europe/London" });

    const [next] = await matches();

    expect(next).toBeDefined();
    expect(localTime(next!.startsAt, "Europe/London")).toEqual({ weekday: 4, time: "19:00" });
    expect(next!.status).toBe("scheduled");
    expect(new Date(next!.startsAt).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(next!.startsAt).getTime()).toBeLessThanOrEqual(Date.now() + 7 * DAY);
  });

  it("gives the Match the template's Venue, Capacity, cost and RSVP deadline", async () => {
    const sean = await newUser();
    const groupId = await createGroup(sean, { name: "Thursday", ownerName: "Sean" });
    const venue = await createVenue(sean, groupId, { name: "Powerleague", defaultCost: 4.5 });

    await saveRecurringTemplate(sean, groupId, {
      weekday: 4, startTime: "19:00", timezone: "UTC", venueId: venue, capacity: 12, rsvpDeadlineHoursBefore: 2,
    });

    const [match] = await getMatches(sean, groupId);
    expect(match).toMatchObject({ capacity: 12, costPerPlayer: 4.5, venue: { id: venue } });
    expect(new Date(match!.startsAt).getTime() - new Date(match!.rsvpDeadline!).getTime()).toBe(2 * HOUR);
  });

  it("lets the template's own cost override the Venue's default", async () => {
    const sean = await newUser();
    const groupId = await createGroup(sean, { name: "Thursday", ownerName: "Sean" });
    const venue = await createVenue(sean, groupId, { name: "Powerleague", defaultCost: 4.5 });

    await saveRecurringTemplate(sean, groupId, { weekday: 4, startTime: "19:00", timezone: "UTC", venueId: venue, costPerPlayer: 6 });

    expect((await getMatches(sean, groupId))[0]!.costPerPlayer).toBe(6);
  });

  it("is one template per Group: saving again edits it", async () => {
    const { sean, groupId } = await thursdays();

    await saveRecurringTemplate(sean, groupId, { weekday: 2, startTime: "20:30", timezone: "UTC", capacity: 14 });

    expect(await getRecurringTemplate(sean, groupId)).toMatchObject({
      weekday: 2, startTime: "20:30", timezone: "UTC", capacity: 14, rsvpLeadDays: 3, paused: false,
    });
    expect(sql(`select count(*) from recurring_templates where group_id = '${groupId}'`)).toBe("1");
  });

  it("is for Admins only, and for members to read", async () => {
    const { groupId, priya } = await thursdays();

    await expect(saveRecurringTemplate(priya, groupId, { weekday: 1, startTime: "18:00", timezone: "UTC" })).rejects.toThrow(/only an admin/);
    await expect(setRecurringPaused(priya, groupId, true)).rejects.toThrow(/only an admin/);
    expect(await getRecurringTemplate(priya, groupId)).toMatchObject({ weekday: 4 });
    expect(await getRecurringTemplate(await newUser(), groupId)).toBeNull();
  });

  it("refuses nonsense", async () => {
    const { sean, groupId } = await thursdays();
    const bad = (t: Partial<Parameters<typeof saveRecurringTemplate>[2]>) =>
      saveRecurringTemplate(sean, groupId, { weekday: 4, startTime: "19:00", timezone: "UTC", ...t });

    await expect(bad({ weekday: 7 })).rejects.toThrow(/weekday/);
    await expect(bad({ startTime: "25:00" })).rejects.toThrow(/time/);
    await expect(bad({ timezone: "Mars/Phobos" })).rejects.toThrow(/time zone/);
    await expect(bad({ capacity: 0 })).rejects.toThrow(/capacity/);
    await expect(bad({ rsvpLeadDays: -1 })).rejects.toThrow(/lead/);
  });
});

describe("The weekly job", () => {
  it("creates each week's Match once, however often it runs", async () => {
    const { groupId, matches } = await thursdays();
    const [first] = await matches();
    const firstKickoff = new Date(first!.startsAt);

    expect(runRecurringJob(new Date(firstKickoff.getTime() - 2 * DAY), groupId)).toBe(0);
    expect(runRecurringJob(new Date(firstKickoff.getTime() + HOUR), groupId)).toBe(1);
    expect(runRecurringJob(new Date(firstKickoff.getTime() + 2 * HOUR), groupId)).toBe(0);

    const all = await matches();
    expect(all).toHaveLength(2);
    expect(new Date(all[1]!.startsAt).getTime() - firstKickoff.getTime()).toBe(7 * DAY);
  });

  it("opens RSVPs at the lead time, and not before", async () => {
    const { groupId, matches } = await thursdays({ rsvpLeadDays: 3 });
    const [match] = await matches();
    const kickoff = new Date(match!.startsAt).getTime();

    runRecurringJob(new Date(kickoff - 3 * DAY - 60_000), groupId);
    expect((await matches())[0]!.status).toBe("scheduled");

    runRecurringJob(new Date(kickoff - 3 * DAY + 60_000), groupId);
    expect((await matches())[0]!.status).toBe("rsvps_open");
  });

  it("keeps the local time of day across a daylight-saving change", async () => {
    const { groupId, matches } = await thursdays({ timezone: "Europe/London" });

    runRecurringJob(new Date("2026-10-16T12:00:00Z"), groupId); // next: Thu 22 Oct, still BST
    runRecurringJob(new Date("2026-10-23T12:00:00Z"), groupId); // next: Thu 29 Oct, clocks have gone back

    const starts = (await matches()).map((m) => m.startsAt);
    expect(starts.find((s) => s.startsWith("2026-10-22"))).toMatch(/18:00:00/);
    expect(starts.find((s) => s.startsWith("2026-10-29"))).toMatch(/19:00:00/);
  });

  it("leaves manually created Matches alone", async () => {
    const { sean, groupId, matches } = await thursdays();
    const manual = await createMatch(sean, groupId, { startsAt: inAWeek() });

    runRecurringJob(new Date(Date.now() + 30 * DAY), groupId);

    const found = (await matches()).find((m) => m.id === manual);
    expect(found!.status).toBe("scheduled");
  });
});

describe("Single-Match changes do not disturb the template", () => {
  it("does not recreate an occurrence whose Match was moved", async () => {
    const { sean, groupId, matches } = await thursdays();
    const [first] = await matches();
    const kickoff = new Date(first!.startsAt);
    await updateMatch(sean, first!.id, { startsAt: new Date(kickoff.getTime() + DAY), costPerPlayer: 9 });

    runRecurringJob(new Date(kickoff.getTime() - DAY), groupId);
    runRecurringJob(new Date(kickoff.getTime() + HOUR), groupId);

    const all = await matches();
    expect(all).toHaveLength(2);
    expect(all[1]!.costPerPlayer).toBe(0); // the template, not the edited Match
  });

  it("does not bring back a cancelled occurrence", async () => {
    const { sean, groupId, matches } = await thursdays();
    const [first] = await matches();
    await cancelMatch(sean, first!.id);

    runRecurringJob(new Date(new Date(first!.startsAt).getTime() - DAY), groupId);

    const all = await matches();
    expect(all).toHaveLength(1);
    expect(all[0]!.status).toBe("cancelled");
  });

  it("applies template edits to Matches created afterwards, not ones that already exist", async () => {
    const { sean, groupId, matches } = await thursdays({ capacity: 10 });
    const [first] = await matches();
    await saveRecurringTemplate(sean, groupId, { weekday: 4, startTime: "19:00", timezone: "UTC", capacity: 12 });

    runRecurringJob(new Date(new Date(first!.startsAt).getTime() + HOUR), groupId);

    const all = await matches();
    expect(all[0]!.capacity).toBe(10);
    expect(all[1]!.capacity).toBe(12);
  });
});

describe("Pausing", () => {
  it("stops new Matches and RSVP opening until resumed", async () => {
    const { sean, groupId, matches } = await thursdays();
    const [first] = await matches();
    const kickoff = new Date(first!.startsAt).getTime();
    await setRecurringPaused(sean, groupId, true);

    expect(runRecurringJob(new Date(kickoff + HOUR), groupId)).toBe(0);
    runRecurringJob(new Date(kickoff - HOUR), groupId);
    expect(await matches()).toHaveLength(1);
    expect((await matches())[0]!.status).toBe("scheduled");

    await setRecurringPaused(sean, groupId, false);
    expect(runRecurringJob(new Date(kickoff + HOUR), groupId)).toBe(1);
  });
});

describe("Who can run the job", () => {
  it("is not available through the API: only the scheduler runs it", async () => {
    const { sean, groupId } = await thursdays();

    const { error } = await sean.rpc("run_recurring_templates", { p_group: groupId });
    expect(error?.message).toMatch(/could not find the function/i);
    expect(sql(`select has_function_privilege('authenticated', 'private.run_recurring_templates(timestamptz, uuid)', 'execute')`)).toBe("f");
  });

  it("is scheduled to run regularly inside the database", () => {
    expect(sql(`select count(*) from cron.job where command like '%run_recurring_templates%'`)).toBe("1");
  });
});
