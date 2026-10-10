import type { SupabaseClient } from "@supabase/supabase-js";
import { generateTeams, type Player, type Rules } from "../team-generator";

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

export type MatchStatus = "scheduled" | "rsvps_open" | "teams_published" | "played" | "cancelled";

export interface Match {
  id: string;
  groupId: string;
  startsAt: string;
  capacity: number;
  costPerPlayer: number;
  rsvpDeadline: string | null;
  status: MatchStatus;
}

export interface MatchSummary extends Match {
  playing: number;
  waitlisted: number;
  spotsLeft: number;
}

export interface MatchRsvp {
  membershipId: string;
  displayName: string;
  response: "in" | "out";
  status: "playing" | "waitlist" | "out";
  waitlistPosition?: number;
  /** Present only for Admins. */
  lateDropout?: boolean;
}

const MATCH_COLUMNS = "id, group_id, starts_at, capacity, cost_per_player, rsvp_deadline, status";

function toMatch(row: Record<string, any>): Match {
  return {
    id: row.id,
    groupId: row.group_id,
    startsAt: row.starts_at,
    capacity: row.capacity,
    costPerPlayer: Number(row.cost_per_player),
    rsvpDeadline: row.rsvp_deadline,
    status: row.status,
  };
}

export function createMatch(
  client: SupabaseClient,
  groupId: string,
  args: { startsAt: Date; capacity?: number; costPerPlayer?: number; rsvpDeadline?: Date },
): Promise<string> {
  return command(client, "create_match", {
    p_group: groupId,
    p_starts_at: args.startsAt.toISOString(),
    p_capacity: args.capacity ?? 10,
    p_cost: args.costPerPlayer ?? 0,
    p_rsvp_deadline: args.rsvpDeadline?.toISOString() ?? null,
  });
}

export async function openRsvps(client: SupabaseClient, matchId: string): Promise<void> {
  await command(client, "open_rsvps", { p_match: matchId });
}

/** Say in or out for yourself, or (Admins) on behalf of another Membership. */
export async function setRsvp(
  client: SupabaseClient,
  matchId: string,
  response: "in" | "out",
  options: { onBehalfOf?: string } = {},
): Promise<void> {
  await command(client, "set_rsvp", {
    p_match: matchId,
    p_response: response,
    p_membership: options.onBehalfOf ?? null,
  });
}

export async function getMatchRsvps(client: SupabaseClient, matchId: string): Promise<MatchRsvp[]> {
  const { data, error } = await client.rpc("match_rsvps", { p_match: matchId });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: Record<string, any>) => ({
    membershipId: row.membership_id,
    displayName: row.display_name,
    response: row.response,
    status: row.status,
    ...(row.waitlist_position === null ? {} : { waitlistPosition: row.waitlist_position }),
    ...(row.late_dropout === null ? {} : { lateDropout: row.late_dropout }),
  }));
}

export async function getMatches(client: SupabaseClient, groupId: string): Promise<Match[]> {
  const { data, error } = await client
    .from("matches")
    .select(MATCH_COLUMNS)
    .eq("group_id", groupId)
    .order("starts_at");
  if (error) throw new Error(error.message);
  return (data ?? []).map(toMatch);
}

export async function getMatch(client: SupabaseClient, matchId: string): Promise<MatchSummary> {
  const { data, error } = await client.from("matches").select(MATCH_COLUMNS).eq("id", matchId).single();
  if (error) throw new Error(error.message);
  const match = toMatch(data);
  const rsvps = await getMatchRsvps(client, matchId);
  const playing = rsvps.filter((r) => r.status === "playing").length;
  return {
    ...match,
    playing,
    waitlisted: rsvps.filter((r) => r.status === "waitlist").length,
    spotsLeft: Math.max(0, match.capacity - playing),
  };
}

export interface TeamPlayer {
  membershipId: string;
  displayName: string;
}

export interface MatchTeams {
  state: "draft" | "published";
  teamA: TeamPlayer[];
  teamB: TeamPlayer[];
}

export async function setHappyInGoal(client: SupabaseClient, membershipId: string, value: boolean): Promise<void> {
  await command(client, "set_happy_in_goal", { p_membership: membershipId, p_value: value });
}

export async function setPairRule(
  client: SupabaseClient,
  a: string,
  b: string,
  kind: "together" | "apart",
): Promise<void> {
  await command(client, "set_pair_rule", { p_a: a, p_b: b, p_kind: kind });
}

export async function removePairRule(client: SupabaseClient, a: string, b: string): Promise<void> {
  await command(client, "remove_pair_rule", { p_a: a, p_b: b });
}

async function getPairRules(client: SupabaseClient, groupId: string): Promise<Rules> {
  const { data, error } = await client
    .from("pair_rules")
    .select("a_membership_id, b_membership_id, kind")
    .eq("group_id", groupId);
  if (error) throw new Error(error.message);
  const pairs = (kind: string) =>
    (data ?? []).filter((r) => r.kind === kind).map((r): [string, string] => [r.a_membership_id, r.b_membership_id]);
  return { together: pairs("together"), apart: pairs("apart") };
}

/** The playing players with everything the generator needs. Admin-only: Ratings are invisible to anyone else. */
async function playingPlayers(client: SupabaseClient, match: Match): Promise<Player[]> {
  const [rsvps, squad] = await Promise.all([getMatchRsvps(client, match.id), getSquad(client, match.groupId)]);
  const playing = new Set(rsvps.filter((r) => r.status === "playing").map((r) => r.membershipId));
  return squad
    .filter((m) => playing.has(m.id))
    .map((m) => {
      if (m.rating === undefined) throw new Error("only an admin can generate teams");
      return {
        id: m.id,
        rating: m.rating,
        happyInGoal: m.happyInGoal,
        ...(m.position ? { position: m.position } : {}),
      };
    });
}

async function rankedSplits(client: SupabaseClient, matchId: string, limit: number) {
  const { data, error } = await client.from("matches").select(MATCH_COLUMNS).eq("id", matchId).single();
  if (error) throw new Error(error.message);
  const match = toMatch(data);
  const players = await playingPlayers(client, match);
  if (players.length < 2) throw new Error("at least two players are needed to make teams");
  return generateTeams(players, await getPairRules(client, match.groupId), { limit });
}

async function saveDraft(client: SupabaseClient, matchId: string, teamA: string[], teamB: string[], rank: number) {
  await command(client, "save_draft_teams", { p_match: matchId, p_team_a: teamA, p_team_b: teamB, p_rank: rank });
}

/** Generate the best split from the Ratings, position tags, happy-in-goal flags and pair rules. Draft only. */
export async function generateDraftTeams(client: SupabaseClient, matchId: string): Promise<void> {
  const [best] = await rankedSplits(client, matchId, 1);
  await saveDraft(client, matchId, best!.teamA, best!.teamB, 0);
}

/** Step to the next-best split in the generator's ranked list. */
export async function reshuffleDraftTeams(client: SupabaseClient, matchId: string): Promise<void> {
  const { data, error } = await client.from("teams").select("rank").eq("match_id", matchId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("there is no draft to reshuffle");
  const next = data.rank + 1;
  const splits = await rankedSplits(client, matchId, next + 1);
  const split = splits[next];
  if (!split) throw new Error("there are no further splits");
  await saveDraft(client, matchId, split.teamA, split.teamB, next);
}

export async function swapPlayers(client: SupabaseClient, matchId: string, a: string, b: string): Promise<void> {
  const [{ data: rows, error }, { data: team }] = await Promise.all([
    client.from("team_players").select("membership_id, side").eq("match_id", matchId),
    client.from("teams").select("rank").eq("match_id", matchId).maybeSingle(),
  ]);
  if (error) throw new Error(error.message);
  const sideOf = new Map((rows ?? []).map((r) => [r.membership_id, r.side]));
  if (!sideOf.has(a) || !sideOf.has(b) || sideOf.get(a) === sideOf.get(b)) {
    throw new Error("pick one player from each team to swap");
  }
  const swapped = (id: string) => (id === a ? sideOf.get(b) : id === b ? sideOf.get(a) : sideOf.get(id));
  const ids = [...sideOf.keys()];
  await saveDraft(
    client,
    matchId,
    ids.filter((id) => swapped(id) === "A"),
    ids.filter((id) => swapped(id) === "B"),
    team?.rank ?? 0,
  );
}

export async function publishTeams(client: SupabaseClient, matchId: string): Promise<void> {
  await command(client, "publish_teams", { p_match: matchId });
}

/** The Teams this user is allowed to see: null if none are visible (e.g. a draft, for a player). */
export async function getTeams(client: SupabaseClient, matchId: string): Promise<MatchTeams | null> {
  const { data: team, error } = await client.from("teams").select("state").eq("match_id", matchId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!team) return null;
  const { data, error: playersError } = await client
    .from("team_players")
    .select("side, membership_id, memberships(display_name)")
    .eq("match_id", matchId);
  if (playersError) throw new Error(playersError.message);
  const side = (which: "A" | "B") =>
    (data ?? [])
      .filter((r) => r.side === which)
      .map((r) => ({
        membershipId: r.membership_id,
        displayName: (r.memberships as unknown as { display_name: string }).display_name,
      }));
  return { state: team.state, teamA: side("A"), teamB: side("B") };
}
