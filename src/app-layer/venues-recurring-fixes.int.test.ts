import { describe, expect, it } from "vitest";
import {
  createGroup,
  createVenue,
  findOrCreateVenue,
  getInviteToken,
  getMatches,
  getRecurringTemplate,
  getVenues,
  joinGroup,
  saveRecurringTemplate,
  updateMatch,
  updateVenue,
} from "./index";
import { newUser, runRecurringJob, sql } from "./test-support";

const HOUR = 3600_000;
const DAY = 24 * HOUR;

async function admin() {
  const sean = await newUser();
  const groupId = await createGroup(sean, { name: "Thursday", ownerName: "Sean" });
  return { sean, groupId };
}

const weekly = { weekday: 4, startTime: "19:00", timezone: "UTC" };

describe("One Admin cannot break the scheduler for everyone", () => {
  it("bounds the RSVP lead time and deadline", async () => {
    const { sean, groupId } = await admin();

    await expect(saveRecurringTemplate(sean, groupId, { ...weekly, rsvpLeadDays: 61 })).rejects.toThrow(/lead time/);
    await expect(saveRecurringTemplate(sean, groupId, { ...weekly, rsvpDeadlineHoursBefore: 721 })).rejects.toThrow(/deadline/);
    await saveRecurringTemplate(sean, groupId, { ...weekly, rsvpLeadDays: 60, rsvpDeadlineHoursBefore: 720 });
  });

  it("carries on with other Groups when one template fails", async () => {
    const good = await admin();
    await saveRecurringTemplate(good.sean, good.groupId, weekly);
    const [first] = await getMatches(good.sean, good.groupId);
    const poisoned = await admin();
    // Impossible through the API (the time zone is validated on save), so insert it directly.
    const poisonId = sql(
      `insert into recurring_templates (group_id, weekday, start_time, timezone) values ('${poisoned.groupId}', 4, '19:00', 'Nowhere/Land') returning id`,
    ).split("\n")[0]!;

    try {
      const created = runRecurringJob(new Date(new Date(first!.startsAt).getTime() + HOUR));
      expect(created).toBeGreaterThanOrEqual(1);
      expect(await getMatches(good.sean, good.groupId)).toHaveLength(2);
    } finally {
      sql(`delete from recurring_templates where id = '${poisonId}'`);
    }
  });
});

describe("Start time must be a real time of day", () => {
  it("rejects 24:00, 'now' and loose text, and accepts ordinary times", async () => {
    const { sean, groupId } = await admin();
    const save = (startTime: string) => saveRecurringTemplate(sean, groupId, { ...weekly, startTime });

    for (const bad of ["24:00", "now", "7pm", "19:60", ""]) {
      await expect(save(bad)).rejects.toThrow(/start time/);
    }
    await save("07:05");
    expect((await getRecurringTemplate(sean, groupId))!.startTime).toBe("07:05");
  });
});

describe("Maps links", () => {
  it("must be a single, clean web address", async () => {
    const { sean, groupId } = await admin();
    const make = (mapsUrl: string) => createVenue(sean, groupId, { name: `V ${Math.random()}`, mapsUrl });

    for (const bad of ["http://x\n<script>", "http://", "https://a b", 'https://x"onmouseover=1', "https://x/<b>"]) {
      await expect(make(bad)).rejects.toThrow(/maps link/);
    }
    await make("https://maps.example.com/p?q=1&r=2#frag");
  });
});

describe("Venue names and clearing fields", () => {
  it("refuses blank names and control characters, with a clear message", async () => {
    const { sean, groupId } = await admin();
    const id = await createVenue(sean, groupId, { name: "Astro" });

    await expect(createVenue(sean, groupId, { name: "   " })).rejects.toThrow(/cannot be blank/);
    await expect(createVenue(sean, groupId, { name: "Pitch 1\t" })).rejects.toThrow(/control characters/);
    await expect(findOrCreateVenue(sean, groupId, "Pitch\n2")).rejects.toThrow(/control characters/);
    await expect(updateVenue(sean, id, { name: " " })).rejects.toThrow(/cannot be blank/);
  });

  it("lets an Admin clear an address or maps link by passing null", async () => {
    const { sean, groupId } = await admin();
    const id = await createVenue(sean, groupId, { name: "Astro", address: "1 Road", mapsUrl: "https://m.example.com/a" });

    await updateVenue(sean, id, { name: "Astro Turf" });
    expect((await getVenues(sean, groupId))[0]).toMatchObject({ address: "1 Road", mapsUrl: "https://m.example.com/a" });

    await updateVenue(sean, id, { address: null, mapsUrl: null });
    expect((await getVenues(sean, groupId))[0]).toMatchObject({ name: "Astro Turf", address: null, mapsUrl: null });
  });
});

describe("RSVP deadline default", () => {
  it("closes RSVPs 24 hours before kick-off unless told otherwise, so late dropouts can be flagged", async () => {
    const { sean, groupId } = await admin();
    await saveRecurringTemplate(sean, groupId, weekly);
    expect((await getRecurringTemplate(sean, groupId))!.rsvpDeadlineHoursBefore).toBe(24);
    const [match] = await getMatches(sean, groupId);
    expect(new Date(match!.startsAt).getTime() - new Date(match!.rsvpDeadline!).getTime()).toBe(DAY);
  });

  it("allows no deadline at all when null is passed", async () => {
    const { sean, groupId } = await admin();
    await saveRecurringTemplate(sean, groupId, { ...weekly, rsvpDeadlineHoursBefore: null });

    expect((await getRecurringTemplate(sean, groupId))!.rsvpDeadlineHoursBefore).toBeNull();
    expect((await getMatches(sean, groupId))[0]!.rsvpDeadline).toBeNull();
  });
});

describe("Changing the template's night", () => {
  it("replaces the next Match if nobody has seen it yet", async () => {
    const { sean, groupId } = await admin();
    await saveRecurringTemplate(sean, groupId, weekly);
    expect(await getMatches(sean, groupId)).toHaveLength(1);

    await saveRecurringTemplate(sean, groupId, { ...weekly, weekday: 1, startTime: "20:00" });

    const matches = await getMatches(sean, groupId);
    expect(matches).toHaveLength(1);
    expect(new Date(matches[0]!.startsAt).getUTCDay()).toBe(1);
    expect(matches[0]!.startsAt).toMatch(/T20:00:00/);
  });

  it("leaves a Match alone once RSVPs are open or the Admin has moved it", async () => {
    const opened = await admin();
    await saveRecurringTemplate(opened.sean, opened.groupId, weekly);
    const [first] = await getMatches(opened.sean, opened.groupId);
    runRecurringJob(new Date(new Date(first!.startsAt).getTime() - 2 * DAY), opened.groupId);
    expect((await getMatches(opened.sean, opened.groupId))[0]!.status).toBe("rsvps_open");

    await saveRecurringTemplate(opened.sean, opened.groupId, { ...weekly, weekday: 1 });
    expect(await getMatches(opened.sean, opened.groupId)).toHaveLength(2);

    const moved = await admin();
    await saveRecurringTemplate(moved.sean, moved.groupId, weekly);
    const [m] = await getMatches(moved.sean, moved.groupId);
    await updateMatch(moved.sean, m!.id, { startsAt: new Date(new Date(m!.startsAt).getTime() + HOUR) });
    await saveRecurringTemplate(moved.sean, moved.groupId, { ...weekly, weekday: 1 });
    expect(await getMatches(moved.sean, moved.groupId)).toHaveLength(2);
  });

  it("does not touch a Match when only the capacity changes", async () => {
    const { sean, groupId } = await admin();
    await saveRecurringTemplate(sean, groupId, weekly);
    const [before] = await getMatches(sean, groupId);

    await saveRecurringTemplate(sean, groupId, { ...weekly, capacity: 14 });

    expect((await getMatches(sean, groupId)).map((m) => m.id)).toEqual([before!.id]);
  });
});

describe("Joining still works alongside templates", () => {
  it("lets a member read the template that an Admin saved", async () => {
    const { sean, groupId } = await admin();
    await saveRecurringTemplate(sean, groupId, weekly);
    const priya = await newUser();
    await joinGroup(priya, await getInviteToken(sean, groupId), { name: "Priya" });

    expect((await getRecurringTemplate(priya, groupId))!.weekday).toBe(4);
  });
});
