import { describe, expect, it } from "vitest";
import { addGhost, createGroup, getInviteToken, getSquad, joinGroup, setRating } from "./index";
import { newEmailUser, newUser, sql } from "./test-support";

describe("Group setup", () => {
  it("makes the creator the Owner of a new Group", async () => {
    const sean = await newUser();
    const groupId = await createGroup(sean, { name: "Thursday 7pm Powerleague", ownerName: "Sean" });

    const squad = await getSquad(sean, groupId);
    expect(squad).toHaveLength(1);
    expect(squad[0]).toMatchObject({ displayName: "Sean", role: "owner", claim: "confirmed" });
  });

  it("lets an Admin add a ghost profile by name, defaulting its Rating to 50", async () => {
    const sean = await newUser();
    const groupId = await createGroup(sean, { name: "Thursday", ownerName: "Sean" });

    await addGhost(sean, groupId, "Dave");

    const dave = (await getSquad(sean, groupId)).find((m) => m.displayName === "Dave");
    expect(dave).toMatchObject({ role: "member", claim: "ghost", rating: 50 });
  });

  it("lets an Admin set a Rating from 1 to 100", async () => {
    const sean = await newUser();
    const groupId = await createGroup(sean, { name: "Thursday", ownerName: "Sean" });
    const daveId = await addGhost(sean, groupId, "Dave");

    await setRating(sean, daveId, 73);

    const dave = (await getSquad(sean, groupId)).find((m) => m.id === daveId);
    expect(dave?.rating).toBe(73);
  });

  it("rejects a Rating outside 1 to 100", async () => {
    const sean = await newUser();
    const groupId = await createGroup(sean, { name: "Thursday", ownerName: "Sean" });
    const daveId = await addGhost(sean, groupId, "Dave");

    await expect(setRating(sean, daveId, 0)).rejects.toThrow();
    await expect(setRating(sean, daveId, 101)).rejects.toThrow();
  });

  it("stops someone outside the Group from adding ghosts, rating people or reading the Squad", async () => {
    const sean = await newUser();
    const groupId = await createGroup(sean, { name: "Thursday", ownerName: "Sean" });
    const daveId = await addGhost(sean, groupId, "Dave");
    const stranger = await newUser();

    await expect(addGhost(stranger, groupId, "Mallory")).rejects.toThrow();
    await expect(setRating(stranger, daveId, 1)).rejects.toThrow();
    expect(await getSquad(stranger, groupId)).toEqual([]);
  });
});

describe("Who can start a Group", () => {
  it("needs a real account when the rule is on, so anonymous sign-in cannot mint unlimited Groups", async () => {
    const anonymous = await newUser();
    const organiser = await newEmailUser();
    sql(`update app_settings set bool_value = true where key = 'require_account_to_create_group'`);
    try {
      await expect(createGroup(anonymous, { name: "Spam", ownerName: "Bot" })).rejects.toThrow(/sign in with your email/);
      await createGroup(organiser.client, { name: "Real", ownerName: "Sean" });
    } finally {
      sql(`update app_settings set bool_value = false where key = 'require_account_to_create_group'`);
    }
  });

  it("still lets anonymous players join a Group someone else started", async () => {
    const organiser = await newEmailUser();
    const groupId = await createGroup(organiser.client, { name: "Real", ownerName: "Sean" });
    sql(`update app_settings set bool_value = true where key = 'require_account_to_create_group'`);
    try {
      await joinGroup(await newUser(), await getInviteToken(organiser.client, groupId), { name: "Priya" });
    } finally {
      sql(`update app_settings set bool_value = false where key = 'require_account_to_create_group'`);
    }
  });
});
