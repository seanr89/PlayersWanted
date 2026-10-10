import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The application layer: the only way the UI changes state or reads Group data.
 * Commands call Postgres functions that check permissions; queries read tables that
 * row-level security has already filtered for the signed-in user.
 */

async function command<T>(client: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export type MemberRole = "owner" | "admin" | "member";
export type ClaimState = "ghost" | "pending" | "confirmed";

export interface SquadMember {
  id: string;
  displayName: string;
  role: MemberRole;
  claim: ClaimState;
  position: "GK" | "defender" | "attacker" | null;
  happyInGoal: boolean;
  /** Present only for Admins: row-level security hides it from everyone else. */
  rating?: number;
}

export function createGroup(client: SupabaseClient, args: { name: string; ownerName: string }): Promise<string> {
  return command(client, "create_group", { p_name: args.name, p_owner_name: args.ownerName });
}

export function addGhost(client: SupabaseClient, groupId: string, name: string): Promise<string> {
  return command(client, "add_ghost", { p_group: groupId, p_name: name });
}

export async function setRating(client: SupabaseClient, membershipId: string, rating: number): Promise<void> {
  await command(client, "set_rating", { p_membership: membershipId, p_rating: rating });
}

export async function getSquad(client: SupabaseClient, groupId: string): Promise<SquadMember[]> {
  const { data, error } = await client
    .from("memberships")
    .select("id, display_name, role, claim, position, happy_in_goal, created_at, membership_ratings(rating)")
    .eq("group_id", groupId)
    .order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const rating = (row.membership_ratings as unknown as { rating: number } | null)?.rating;
    return {
      id: row.id,
      displayName: row.display_name,
      role: row.role,
      claim: row.claim,
      position: row.position,
      happyInGoal: row.happy_in_goal,
      ...(rating === undefined ? {} : { rating }),
    };
  });
}

export interface Invite {
  groupName: string;
  ghosts: { id: string; displayName: string }[];
}

export function getInviteToken(client: SupabaseClient, groupId: string): Promise<string> {
  return command(client, "get_invite_token", { p_group: groupId });
}

export function getInvite(client: SupabaseClient, token: string): Promise<Invite> {
  return command(client, "get_invite", { p_token: token });
}

/** Join with a new Membership, or pass `claim` to take a ghost profile (pending admin confirmation). */
export function joinGroup(
  client: SupabaseClient,
  token: string,
  args: { name: string; claim?: string },
): Promise<string> {
  return command(client, "join_group", { p_token: token, p_name: args.name, p_claim: args.claim ?? null });
}

export async function confirmClaim(client: SupabaseClient, membershipId: string): Promise<void> {
  await command(client, "confirm_claim", { p_membership: membershipId });
}

export async function rejectClaim(client: SupabaseClient, membershipId: string): Promise<void> {
  await command(client, "reject_claim", { p_membership: membershipId });
}

export async function getPendingClaims(client: SupabaseClient, groupId: string): Promise<SquadMember[]> {
  return (await getSquad(client, groupId)).filter((m) => m.claim === "pending");
}
