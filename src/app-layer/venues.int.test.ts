import { describe, expect, it } from "vitest";
import {
  createGroup,
  createMatch,
  createVenue,
  findOrCreateVenue,
  getInviteToken,
  getMatch,
  getVenues,
  joinGroup,
  setMatchVenue,
  updateVenue,
} from "./index";
import { inAWeek, newUser } from "./test-support";

async function group() {
  const sean = await newUser();
  const groupId = await createGroup(sean, { name: "Thursday", ownerName: "Sean" });
  const priya = await newUser();
  await joinGroup(priya, await getInviteToken(sean, groupId), { name: "Priya" });
  return { sean, groupId, priya };
}

describe("Venues", () => {
  it("lets an Admin save a Venue with an address, maps link and default cost, visible to members", async () => {
    const { sean, groupId, priya } = await group();

    const id = await createVenue(sean, groupId, {
      name: "Powerleague",
      address: "1 Pitch Road",
      mapsUrl: "https://maps.example.com/powerleague",
      defaultCost: 4.5,
    });

    expect(await getVenues(priya, groupId)).toEqual([
      { id, name: "Powerleague", address: "1 Pitch Road", mapsUrl: "https://maps.example.com/powerleague", defaultCost: 4.5 },
    ]);
  });

  it("needs only a name", async () => {
    const { sean, groupId } = await group();

    await createVenue(sean, groupId, { name: "Astro" });

    expect((await getVenues(sean, groupId))[0]).toMatchObject({ name: "Astro", address: null, mapsUrl: null, defaultCost: 0 });
  });

  it("is for Admins only, and invisible to strangers", async () => {
    const { sean, groupId, priya } = await group();
    await createVenue(sean, groupId, { name: "Astro" });

    await expect(createVenue(priya, groupId, { name: "Mine" })).rejects.toThrow(/only an admin/);
    expect(await getVenues(await newUser(), groupId)).toEqual([]);
  });

  it("creates a Venue inline the first time it is typed, and reuses it after", async () => {
    const { sean, groupId } = await group();

    const first = await findOrCreateVenue(sean, groupId, "Powerleague");
    const again = await findOrCreateVenue(sean, groupId, "  powerLEAGUE ");

    expect(again).toBe(first);
    expect(await getVenues(sean, groupId)).toHaveLength(1);
    expect(await findOrCreateVenue(sean, groupId, "Astro")).not.toBe(first);
  });

  it("refuses two Venues with the same name in a Group, but allows it across Groups", async () => {
    const one = await group();
    const two = await group();
    await createVenue(one.sean, one.groupId, { name: "Powerleague" });

    await expect(createVenue(one.sean, one.groupId, { name: "powerleague" })).rejects.toThrow(/already exists/);
    await createVenue(two.sean, two.groupId, { name: "Powerleague" });
  });

  it("lets an Admin edit a Venue", async () => {
    const { sean, groupId, priya } = await group();
    const id = await createVenue(sean, groupId, { name: "Astro", defaultCost: 3 });

    await updateVenue(sean, id, { address: "2 New Road", defaultCost: 5 });

    expect((await getVenues(sean, groupId))[0]).toMatchObject({ name: "Astro", address: "2 New Road", defaultCost: 5 });
    await expect(updateVenue(priya, id, { name: "Hijacked" })).rejects.toThrow(/only an admin/);
  });

  it("only accepts web links for the maps link, so a player is never sent to a script URL", async () => {
    const { sean, groupId } = await group();

    await expect(createVenue(sean, groupId, { name: "Bad", mapsUrl: "javascript:alert(1)" })).rejects.toThrow(/maps link/);
    const id = await createVenue(sean, groupId, { name: "Good", mapsUrl: "http://maps.example.com/x" });
    await expect(updateVenue(sean, id, { mapsUrl: "data:text/html,hi" })).rejects.toThrow(/maps link/);
  });
});

describe("Venues on Matches", () => {
  it("lets a Match pick up the Venue's default cost unless one is given", async () => {
    const { sean, groupId } = await group();
    const venue = await createVenue(sean, groupId, { name: "Powerleague", defaultCost: 4.5 });

    const defaulted = await createMatch(sean, groupId, { startsAt: inAWeek(), venueId: venue });
    const explicit = await createMatch(sean, groupId, { startsAt: inAWeek(), venueId: venue, costPerPlayer: 6 });
    const free = await createMatch(sean, groupId, { startsAt: inAWeek(), venueId: venue, costPerPlayer: 0 });

    expect((await getMatch(sean, defaulted)).costPerPlayer).toBe(4.5);
    expect((await getMatch(sean, explicit)).costPerPlayer).toBe(6);
    expect((await getMatch(sean, free)).costPerPlayer).toBe(0);
  });

  it("shows players the Venue, including the maps link", async () => {
    const { sean, groupId, priya } = await group();
    const venue = await createVenue(sean, groupId, { name: "Powerleague", address: "1 Pitch Road", mapsUrl: "https://maps.example.com/p" });
    const matchId = await createMatch(sean, groupId, { startsAt: inAWeek(), venueId: venue });

    expect((await getMatch(priya, matchId)).venue).toEqual({
      id: venue,
      name: "Powerleague",
      address: "1 Pitch Road",
      mapsUrl: "https://maps.example.com/p",
    });
  });

  it("can change or clear a Match's Venue, but never to another Group's Venue", async () => {
    const one = await group();
    const two = await group();
    const mine = await createVenue(one.sean, one.groupId, { name: "Mine" });
    const theirs = await createVenue(two.sean, two.groupId, { name: "Theirs" });
    const matchId = await createMatch(one.sean, one.groupId, { startsAt: inAWeek() });

    await setMatchVenue(one.sean, matchId, mine);
    expect((await getMatch(one.sean, matchId)).venue?.name).toBe("Mine");
    await expect(setMatchVenue(one.sean, matchId, theirs)).rejects.toThrow(/venue/i);
    await expect(createMatch(one.sean, one.groupId, { startsAt: inAWeek(), venueId: theirs })).rejects.toThrow(/venue/i);

    await setMatchVenue(one.sean, matchId, null);
    expect((await getMatch(one.sean, matchId)).venue).toBeNull();
  });
});
