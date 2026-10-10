import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  addGhost,
  addGuest,
  createGroup,
  createMatch,
  generateDraftTeams,
  getGuests,
  getInvite,
  getInviteToken,
  getMatch,
  getMatchRsvps,
  getSquad,
  getTeams,
  joinGroup,
  openRsvps,
  promoteGuest,
  removeGuest,
  setRating,
  setRsvp,
} from "./index";
import { byName, inAWeek, newUser } from "./test-support";

/** Sean organises; Priya and Mo are ordinary members; one Match with RSVPs open. */
async function openMatch(capacity = 10) {
  const sean = await newUser();
  const groupId = await createGroup(sean, { name: "Thursday", ownerName: "Sean" });
  const token = await getInviteToken(sean, groupId);
  const priya = await newUser();
  const priyaId = await joinGroup(priya, token, { name: "Priya" });
  const mo = await newUser();
  await joinGroup(mo, token, { name: "Mo" });
  const matchId = await createMatch(sean, groupId, { startsAt: inAWeek(), capacity });
  await openRsvps(sean, matchId);
  return { sean, groupId, token, priya, priyaId, mo, matchId };
}

describe("Adding a Guest", () => {
  it("lets a member bring a Guest, who takes a Capacity slot like any other 'in'", async () => {
    const { priya, sean, matchId } = await openMatch(2);
    await setRsvp(priya, matchId, "in");

    await addGuest(priya, matchId, "Priya's brother");

    const rsvps = byName(await getMatchRsvps(sean, matchId));
    expect(rsvps["Priya's brother"]).toMatchObject({ status: "playing", isGuest: true });
    expect(rsvps.Priya).toMatchObject({ status: "playing", isGuest: false });
    expect(await getMatch(sean, matchId)).toMatchObject({ playing: 2, spotsLeft: 0 });
  });

  it("puts a Guest added at Capacity on the Waitlist rather than jumping the queue", async () => {
    const { priya, mo, sean, matchId } = await openMatch(1);
    await setRsvp(mo, matchId, "in");

    await addGuest(priya, matchId, "Priya's brother");

    const rsvps = byName(await getMatchRsvps(sean, matchId));
    expect(rsvps["Priya's brother"]).toMatchObject({ status: "waitlist", waitlistPosition: 1 });
  });

  it("keeps Guests out of the Squad and the invite's ghost list", async () => {
    const { priya, sean, groupId, token, matchId } = await openMatch();
    await addGuest(priya, matchId, "Priya's brother");

    expect((await getSquad(sean, groupId)).map((m) => m.displayName)).not.toContain("Priya's brother");
    expect((await getInvite(await newUser(), token)).ghosts).toEqual([]);
  });

  it("is for members only, and only while RSVPs are open", async () => {
    const { sean, groupId, matchId } = await openMatch();
    await expect(addGuest(await newUser(), matchId, "Mallory")).rejects.toThrow(/match not found/);

    const scheduled = await createMatch(sean, groupId, { startsAt: inAWeek() });
    await expect(addGuest(sean, scheduled, "Early bird")).rejects.toThrow(/not open/);
  });
});

describe("Guest Ratings", () => {
  it("defaults a Guest's Rating to the Group average until an Admin sets one", async () => {
    const { sean, groupId, priya, matchId } = await openMatch();
    // Group: Sean 50 (default), Priya 50, Mo 50 -> make the average something recognisable.
    const squad = await getSquad(sean, groupId);
    const ratings: Record<string, number> = { Sean: 80, Priya: 60, Mo: 40 };
    for (const m of squad) await setRating(sean, m.id, ratings[m.displayName]!);
    const guestId = await addGuest(priya, matchId, "Priya's brother");

    const [before] = await getGuests(sean, matchId);
    expect(before).toMatchObject({ id: guestId, sponsorName: "Priya", effectiveRating: 60 });
    expect(before?.rating).toBeUndefined();

    await setRating(sean, guestId, 25);

    const [after] = await getGuests(sean, matchId);
    expect(after).toMatchObject({ rating: 25, effectiveRating: 25 });
  });

  it("hides Guest Ratings from players", async () => {
    const { sean, priya, matchId } = await openMatch();
    const guestId = await addGuest(priya, matchId, "Priya's brother");
    await setRating(sean, guestId, 25);

    const [guest] = await getGuests(priya, matchId);
    expect(guest).not.toHaveProperty("rating");
    expect(guest).not.toHaveProperty("effectiveRating");
    await expect(setRating(priya, guestId, 99)).rejects.toThrow();
  });

  it("includes Guests when generating Teams", async () => {
    const { sean, priya, mo, matchId } = await openMatch();
    await setRsvp(priya, matchId, "in");
    await setRsvp(mo, matchId, "in");
    await addGuest(priya, matchId, "Priya's brother");

    await generateDraftTeams(sean, matchId);

    const teams = (await getTeams(sean, matchId))!;
    expect([...teams.teamA, ...teams.teamB].map((p) => p.displayName).sort()).toEqual([
      "Mo",
      "Priya",
      "Priya's brother",
    ]);
  });
});

describe("Removing and promoting Guests", () => {
  it("lets the sponsor or an Admin remove a Guest, but not another member", async () => {
    const { sean, priya, mo, matchId } = await openMatch();
    const first = await addGuest(priya, matchId, "Guest 1");
    const second = await addGuest(priya, matchId, "Guest 2");

    await expect(removeGuest(mo, first)).rejects.toThrow(/not allowed/);
    await removeGuest(priya, first);
    await removeGuest(sean, second);

    expect(await getGuests(sean, matchId)).toEqual([]);
    expect(await getMatchRsvps(sean, matchId)).toEqual([]);
  });

  it("lets an Admin promote a Guest to a full Membership who keeps their RSVP and Rating", async () => {
    const { sean, groupId, priya, matchId } = await openMatch();
    const guestId = await addGuest(priya, matchId, "Priya's brother");
    await setRating(sean, guestId, 70);

    await promoteGuest(sean, guestId);

    const member = (await getSquad(sean, groupId)).find((m) => m.id === guestId);
    expect(member).toMatchObject({ displayName: "Priya's brother", role: "member", claim: "ghost", rating: 70 });
    expect(await getGuests(sean, matchId)).toEqual([]);
    expect(byName(await getMatchRsvps(sean, matchId))["Priya's brother"]).toMatchObject({
      status: "playing",
      isGuest: false,
    });
  });

  it("only lets Admins promote", async () => {
    const { priya, matchId } = await openMatch();
    const guestId = await addGuest(priya, matchId, "Priya's brother");

    await expect(promoteGuest(priya, guestId)).rejects.toThrow(/only an admin/);
  });

  it("does not let an ordinary ghost be removed as if it were a Guest", async () => {
    const { sean, groupId } = await openMatch();
    const ghost = await addGhost(sean, groupId, "Dave");

    await expect(removeGuest(sean, ghost)).rejects.toThrow(/not a guest/);
  });
});
