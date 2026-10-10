import { describe, expect, it } from "vitest";
import {
  addGhost,
  confirmClaim,
  createGroup,
  getInvite,
  getInviteToken,
  getPendingClaims,
  getSquad,
  joinGroup,
  rejectClaim,
  setRating,
} from "./index";
import { newUser } from "./test-support";

/** A Group with an owner (Sean) and a ghost profile for Dave. */
async function thursdayGroup() {
  const sean = await newUser();
  const groupId = await createGroup(sean, { name: "Thursday", ownerName: "Sean" });
  const daveGhost = await addGhost(sean, groupId, "Dave");
  const token = await getInviteToken(sean, groupId);
  return { sean, groupId, daveGhost, token };
}

describe("Invite link", () => {
  it("shows the Group name and only the unclaimed ghost profiles", async () => {
    const { sean, groupId, token } = await thursdayGroup();
    await addGhost(sean, groupId, "Mo");

    const invite = await getInvite(await newUser(), token);

    expect(invite.groupName).toBe("Thursday");
    expect(invite.ghosts.map((g) => g.displayName).sort()).toEqual(["Dave", "Mo"]);
  });

  it("does not work for a made-up token", async () => {
    await expect(getInvite(await newUser(), "not-a-real-token")).rejects.toThrow();
  });

  it("keeps the invite token away from ordinary players", async () => {
    const { groupId, token } = await thursdayGroup();
    const player = await newUser();
    await joinGroup(player, token, { name: "Priya" });

    await expect(getInviteToken(player, groupId)).rejects.toThrow();
  });
});

describe("Joining and claiming", () => {
  it("lets a player claim a ghost profile instantly, pending admin confirmation", async () => {
    const { sean, groupId, daveGhost, token } = await thursdayGroup();
    const dave = await newUser();

    const membershipId = await joinGroup(dave, token, { name: "Dave", claim: daveGhost });

    expect(membershipId).toBe(daveGhost);
    const squad = await getSquad(dave, groupId);
    expect(squad.map((m) => m.displayName)).toContain("Sean");
    expect((await getSquad(sean, groupId)).find((m) => m.id === daveGhost)?.claim).toBe("pending");
    expect((await getInvite(await newUser(), token)).ghosts).toEqual([]);
  });

  it("lets a player who is not on the ghost list join with a new Membership", async () => {
    const { sean, groupId, token } = await thursdayGroup();
    const priya = await newUser();

    await joinGroup(priya, token, { name: "Priya" });

    const priyaRow = (await getSquad(sean, groupId)).find((m) => m.displayName === "Priya");
    expect(priyaRow).toMatchObject({ role: "member", claim: "confirmed", rating: 50 });
  });

  it("never lets a ghost profile be claimed twice", async () => {
    const { daveGhost, token } = await thursdayGroup();
    await joinGroup(await newUser(), token, { name: "Dave", claim: daveGhost });

    await expect(joinGroup(await newUser(), token, { name: "Not Dave", claim: daveGhost })).rejects.toThrow();
  });

  it("does not let the same person join a Group twice", async () => {
    const { token } = await thursdayGroup();
    const priya = await newUser();
    await joinGroup(priya, token, { name: "Priya" });

    await expect(joinGroup(priya, token, { name: "Priya again" })).rejects.toThrow();
  });

  it("lets one Person hold Memberships in several Groups with separate Ratings", async () => {
    const one = await thursdayGroup();
    const two = await thursdayGroup();
    const mo = await newUser();
    const inOne = await joinGroup(mo, one.token, { name: "Mo" });
    const inTwo = await joinGroup(mo, two.token, { name: "Mo" });
    await setRating(one.sean, inOne, 90);

    expect((await getSquad(one.sean, one.groupId)).find((m) => m.id === inOne)?.rating).toBe(90);
    expect((await getSquad(two.sean, two.groupId)).find((m) => m.id === inTwo)?.rating).toBe(50);
  });
});

describe("Confirming claims", () => {
  it("lets an Admin confirm a pending claim", async () => {
    const { sean, groupId, daveGhost, token } = await thursdayGroup();
    await joinGroup(await newUser(), token, { name: "Dave", claim: daveGhost });
    expect((await getPendingClaims(sean, groupId)).map((m) => m.id)).toEqual([daveGhost]);

    await confirmClaim(sean, daveGhost);

    expect(await getPendingClaims(sean, groupId)).toEqual([]);
    expect((await getSquad(sean, groupId)).find((m) => m.id === daveGhost)?.claim).toBe("confirmed");
  });

  it("returns a rejected claim to the unclaimed list and takes the claimer's access away", async () => {
    const { sean, groupId, daveGhost, token } = await thursdayGroup();
    const wrongPerson = await newUser();
    await joinGroup(wrongPerson, token, { name: "Dave", claim: daveGhost });

    await rejectClaim(sean, daveGhost);

    expect((await getInvite(await newUser(), token)).ghosts.map((g) => g.id)).toEqual([daveGhost]);
    expect(await getSquad(wrongPerson, groupId)).toEqual([]);
  });

  it("only lets Admins confirm or reject", async () => {
    const { daveGhost, token } = await thursdayGroup();
    const claimer = await newUser();
    await joinGroup(claimer, token, { name: "Dave", claim: daveGhost });
    const bystander = await newUser();
    await joinGroup(bystander, token, { name: "Priya" });

    await expect(confirmClaim(bystander, daveGhost)).rejects.toThrow();
    await expect(rejectClaim(claimer, daveGhost)).rejects.toThrow();
  });
});

describe("Rating privacy", () => {
  it("hides every Rating from players, including by querying the table directly", async () => {
    const { sean, groupId, daveGhost, token } = await thursdayGroup();
    await setRating(sean, daveGhost, 81);
    const priya = await newUser();
    const priyaId = await joinGroup(priya, token, { name: "Priya" });

    const squad = await getSquad(priya, groupId);
    expect(squad.length).toBeGreaterThan(1);
    for (const member of squad) expect(member).not.toHaveProperty("rating");

    const direct = await priya.from("membership_ratings").select("*");
    expect(direct.data).toEqual([]);
    await expect(setRating(priya, priyaId, 100)).rejects.toThrow();
  });

  it("keeps a ghost's Rating when the real player claims it, without showing it to them", async () => {
    const { sean, groupId, daveGhost, token } = await thursdayGroup();
    await setRating(sean, daveGhost, 64);
    const dave = await newUser();
    await joinGroup(dave, token, { name: "Dave", claim: daveGhost });
    await confirmClaim(sean, daveGhost);

    expect((await getSquad(sean, groupId)).find((m) => m.id === daveGhost)?.rating).toBe(64);
    expect((await getSquad(dave, groupId)).find((m) => m.id === daveGhost)).not.toHaveProperty("rating");
  });

  it("does not let players write to tables directly", async () => {
    const { groupId, token } = await thursdayGroup();
    const priya = await newUser();
    const priyaId = await joinGroup(priya, token, { name: "Priya" });

    const promote = await priya.from("memberships").update({ role: "owner" }).eq("id", priyaId);
    expect(promote.error).not.toBeNull();
    const rate = await priya.from("membership_ratings").update({ rating: 100 }).eq("membership_id", priyaId);
    expect(rate.error).not.toBeNull();
    expect((await getSquad(priya, groupId)).find((m) => m.id === priyaId)?.role).toBe("member");
  });
});
