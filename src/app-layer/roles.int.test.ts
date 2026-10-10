import { describe, expect, it } from "vitest";
import {
  addGhost,
  createGroup,
  deleteGroup,
  demoteAdmin,
  getGroup,
  getInviteToken,
  getMyGroups,
  getSquad,
  joinGroup,
  promoteToAdmin,
  transferOwnership,
  updateGroup,
} from "./index";
import { newUser } from "./test-support";

/** Sean owns "Thursday"; Priya and Mo have joined as ordinary members. */
async function thursday() {
  const sean = await newUser();
  const groupId = await createGroup(sean, { name: "Thursday", ownerName: "Sean" });
  const token = await getInviteToken(sean, groupId);
  const priya = await newUser();
  const priyaId = await joinGroup(priya, token, { name: "Priya" });
  const mo = await newUser();
  const moId = await joinGroup(mo, token, { name: "Mo" });
  return { sean, groupId, token, priya, priyaId, mo, moId };
}

describe("Group settings", () => {
  it("lets an Admin rename the Group and change its settings, visible to every member", async () => {
    const { sean, priya, groupId } = await thursday();

    await updateGroup(sean, groupId, { name: "Thursday 7pm Powerleague", minPlayers: 9, showTeamStrength: true });

    expect(await getGroup(priya, groupId)).toMatchObject({
      name: "Thursday 7pm Powerleague",
      minPlayers: 9,
      showTeamStrength: true,
    });
  });

  it("leaves unchanged anything you did not mention", async () => {
    const { sean, groupId } = await thursday();
    await updateGroup(sean, groupId, { minPlayers: 7 });

    expect(await getGroup(sean, groupId)).toMatchObject({ name: "Thursday", minPlayers: 7, showTeamStrength: false });
  });

  it("is for Admins only, and refuses nonsense values", async () => {
    const { sean, priya, groupId } = await thursday();

    await expect(updateGroup(priya, groupId, { name: "Hijacked" })).rejects.toThrow(/only an admin/);
    await expect(updateGroup(sean, groupId, { minPlayers: 0 })).rejects.toThrow();
    await expect(updateGroup(sean, groupId, { name: "   " })).rejects.toThrow();
    expect((await getGroup(sean, groupId)).name).toBe("Thursday");
  });

  it("tells each member their own role", async () => {
    const { sean, priya, groupId } = await thursday();

    expect((await getGroup(sean, groupId)).myRole).toBe("owner");
    expect((await getGroup(priya, groupId)).myRole).toBe("member");
  });

  it("lists the Groups a person belongs to", async () => {
    const { priya, groupId } = await thursday();
    const other = await createGroup(priya, { name: "Sunday kickabout", ownerName: "Priya" });

    const mine = await getMyGroups(priya);

    expect(mine.map((g) => g.id).sort()).toEqual([groupId, other].sort());
    expect(mine.find((g) => g.id === other)?.myRole).toBe("owner");
    expect(mine.find((g) => g.id === groupId)?.myRole).toBe("member");
  });
});

describe("Admins", () => {
  it("lets the Owner promote a member, who then has organiser powers", async () => {
    const { sean, priya, priyaId, groupId } = await thursday();
    await expect(addGhost(priya, groupId, "Dave")).rejects.toThrow();

    await promoteToAdmin(sean, priyaId);

    await addGhost(priya, groupId, "Dave");
    expect((await getGroup(priya, groupId)).myRole).toBe("admin");
  });

  it("lets the Owner demote an Admin, taking the powers away", async () => {
    const { sean, priya, priyaId, groupId } = await thursday();
    await promoteToAdmin(sean, priyaId);

    await demoteAdmin(sean, priyaId);

    await expect(addGhost(priya, groupId, "Dave")).rejects.toThrow();
  });

  it("stops anyone but the Owner changing who is an Admin", async () => {
    const { sean, priya, priyaId, mo, moId } = await thursday();
    await promoteToAdmin(sean, priyaId);

    await expect(promoteToAdmin(priya, moId)).rejects.toThrow(/only the owner/);
    await expect(promoteToAdmin(mo, moId)).rejects.toThrow(/only the owner/);
    await expect(demoteAdmin(priya, priyaId)).rejects.toThrow(/only the owner/);
  });

  it("only promotes real, confirmed members: not ghosts, and not the Owner twice", async () => {
    const { sean, groupId } = await thursday();
    const ghost = await addGhost(sean, groupId, "Dave");
    const squad = await getSquad(sean, groupId);
    const ownerRow = squad.find((m) => m.role === "owner")!;

    await expect(promoteToAdmin(sean, ghost)).rejects.toThrow(/confirmed member/);
    await expect(promoteToAdmin(sean, ownerRow.id)).rejects.toThrow();
  });

  it("never lets the Owner be demoted", async () => {
    const { sean, groupId } = await thursday();
    const ownerRow = (await getSquad(sean, groupId)).find((m) => m.role === "owner")!;

    await expect(demoteAdmin(sean, ownerRow.id)).rejects.toThrow(/only admins/);
    expect((await getGroup(sean, groupId)).myRole).toBe("owner");
  });
});

describe("Ownership", () => {
  it("lets the Owner hand the Group to an Admin, who becomes the only Owner", async () => {
    const { sean, priya, priyaId, groupId } = await thursday();
    await promoteToAdmin(sean, priyaId);

    await transferOwnership(sean, priyaId);

    expect((await getGroup(priya, groupId)).myRole).toBe("owner");
    expect((await getGroup(sean, groupId)).myRole).toBe("admin");
    expect((await getSquad(sean, groupId)).filter((m) => m.role === "owner")).toHaveLength(1);
  });

  it("only transfers to an existing Admin, and only if you are the Owner", async () => {
    const { sean, priya, priyaId, moId } = await thursday();
    await promoteToAdmin(sean, priyaId);

    await expect(transferOwnership(sean, moId)).rejects.toThrow(/an admin/);
    await expect(transferOwnership(priya, priyaId)).rejects.toThrow(/only the owner/);
  });

  it("lets only the Owner delete the Group, taking its data with it", async () => {
    const { sean, priya, priyaId, groupId } = await thursday();
    await promoteToAdmin(sean, priyaId);

    await expect(deleteGroup(priya, groupId)).rejects.toThrow(/only the owner/);
    await deleteGroup(sean, groupId);

    expect(await getSquad(sean, groupId)).toEqual([]);
    expect((await getMyGroups(sean)).map((g) => g.id)).not.toContain(groupId);
  });
});
