import { describe, expect, it } from "vitest";
import {
  addGhost,
  cancelMatch,
  createGroup,
  createMatch,
  generateDraftTeams,
  getInviteToken,
  getMatch,
  getMatchRsvps,
  joinGroup,
  openRsvps,
  publishTeams,
  setRating,
  setRsvp,
  updateMatch,
} from "./index";
import { byName, inAWeek, newUser } from "./test-support";

async function group() {
  const sean = await newUser();
  const groupId = await createGroup(sean, { name: "Thursday", ownerName: "Sean" });
  const token = await getInviteToken(sean, groupId);
  const priya = await newUser();
  await joinGroup(priya, token, { name: "Priya" });
  return { sean, groupId, token, priya };
}

describe("Editing a single Match", () => {
  it("changes that Match only", async () => {
    const { sean, groupId } = await group();
    const thisWeek = await createMatch(sean, groupId, { startsAt: inAWeek(), costPerPlayer: 4 });
    const nextWeek = await createMatch(sean, groupId, { startsAt: inAWeek(), costPerPlayer: 4 });
    const later = new Date(Date.now() + 8 * 24 * 3600 * 1000);

    await updateMatch(sean, thisWeek, { startsAt: later, costPerPlayer: 5.5 });

    const edited = await getMatch(sean, thisWeek);
    expect(new Date(edited.startsAt).getTime()).toBe(later.getTime());
    expect(edited.costPerPlayer).toBe(5.5);
    expect(await getMatch(sean, nextWeek)).toMatchObject({ costPerPlayer: 4 });
  });

  it("is for Admins only", async () => {
    const { sean, groupId, priya } = await group();
    const matchId = await createMatch(sean, groupId, { startsAt: inAWeek() });

    await expect(updateMatch(priya, matchId, { costPerPlayer: 0 })).rejects.toThrow(/only an admin/);
    await expect(cancelMatch(priya, matchId)).rejects.toThrow(/only an admin/);
  });

  it("re-sorts the Waitlist when Capacity changes while RSVPs are open", async () => {
    const { sean, groupId, token } = await group();
    const matchId = await createMatch(sean, groupId, { startsAt: inAWeek(), capacity: 1 });
    await openRsvps(sean, matchId);
    for (const name of ["A", "B"]) {
      const client = await newUser();
      await joinGroup(client, token, { name });
      await setRsvp(client, matchId, "in");
    }
    expect(byName(await getMatchRsvps(sean, matchId)).B?.status).toBe("waitlist");

    await updateMatch(sean, matchId, { capacity: 2 });

    expect(byName(await getMatchRsvps(sean, matchId)).B?.status).toBe("playing");
  });

  it("allows a change of time after Teams are published, but not a change of Capacity", async () => {
    const { sean, groupId } = await group();
    const matchId = await createMatch(sean, groupId, { startsAt: inAWeek(), capacity: 2 });
    await openRsvps(sean, matchId);
    for (const name of ["A", "B"]) {
      const id = await addGhost(sean, groupId, name);
      await setRating(sean, id, 50);
      await setRsvp(sean, matchId, "in", { onBehalfOf: id });
    }
    await generateDraftTeams(sean, matchId);
    await publishTeams(sean, matchId);

    const rescheduled = new Date(Date.now() + 9 * 24 * 3600 * 1000);
    await updateMatch(sean, matchId, { startsAt: rescheduled });
    expect(new Date((await getMatch(sean, matchId)).startsAt).getTime()).toBe(rescheduled.getTime());
    await expect(updateMatch(sean, matchId, { capacity: 3 })).rejects.toThrow(/capacity/i);
  });
});

describe("Cancelling a Match", () => {
  it("marks it cancelled and stops further RSVPs", async () => {
    const { sean, groupId, priya } = await group();
    const matchId = await createMatch(sean, groupId, { startsAt: inAWeek() });
    await openRsvps(sean, matchId);

    await cancelMatch(sean, matchId);

    expect((await getMatch(sean, matchId)).status).toBe("cancelled");
    await expect(setRsvp(priya, matchId, "in")).rejects.toThrow(/not open/);
  });

  it("cannot be done twice, and a cancelled Match cannot be edited or reopened", async () => {
    const { sean, groupId } = await group();
    const matchId = await createMatch(sean, groupId, { startsAt: inAWeek() });
    await cancelMatch(sean, matchId);

    await expect(cancelMatch(sean, matchId)).rejects.toThrow(/already cancelled/);
    await expect(updateMatch(sean, matchId, { costPerPlayer: 1 })).rejects.toThrow(/cancelled|played/i);
    await expect(openRsvps(sean, matchId)).rejects.toThrow(/scheduled match/);
  });
});
