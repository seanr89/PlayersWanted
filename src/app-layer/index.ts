import type { SupabaseClient } from "@supabase/supabase-js";
import { generateTeams, scoreSplit, type Player, type Rules } from "../team-generator";

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

export async function isAdmin(client: SupabaseClient, groupId: string): Promise<boolean> {
  const { data } = await client.rpc("is_group_admin", { p_group: groupId });
  return data === true;
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
    .is("guest_match_id", null)
    .eq("departed", false)
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
  groupId: string;
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

export interface VenueSummary {
  id: string;
  name: string;
  address: string | null;
  mapsUrl: string | null;
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
  venue: VenueSummary | null;
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
  isGuest: boolean;
}

const MATCH_COLUMNS =
  "id, group_id, starts_at, capacity, cost_per_player, rsvp_deadline, status, venues(id, name, address, maps_url)";

function toMatch(row: Record<string, any>): Match {
  return {
    id: row.id,
    groupId: row.group_id,
    startsAt: row.starts_at,
    capacity: row.capacity,
    costPerPlayer: Number(row.cost_per_player),
    rsvpDeadline: row.rsvp_deadline,
    status: row.status,
    venue: row.venues
      ? { id: row.venues.id, name: row.venues.name, address: row.venues.address, mapsUrl: row.venues.maps_url }
      : null,
  };
}

export function createMatch(
  client: SupabaseClient,
  groupId: string,
  args: { startsAt: Date; capacity?: number; costPerPlayer?: number; rsvpDeadline?: Date; venueId?: string },
): Promise<string> {
  return command(client, "create_match", {
    p_group: groupId,
    p_starts_at: args.startsAt.toISOString(),
    p_capacity: args.capacity ?? 10,
    p_cost: args.costPerPlayer ?? null, // null: use the Venue's default cost
    p_rsvp_deadline: args.rsvpDeadline?.toISOString() ?? null,
    p_venue: args.venueId ?? null,
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
    isGuest: row.is_guest,
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

export async function fetchMatch(client: SupabaseClient, matchId: string): Promise<Match> {
  const { data, error } = await client.from("matches").select(MATCH_COLUMNS).eq("id", matchId).single();
  if (error) throw new Error(error.message);
  return toMatch(data);
}

export async function getMatch(client: SupabaseClient, matchId: string): Promise<MatchSummary> {
  const match = await fetchMatch(client, matchId);
  const rsvps = await getMatchRsvps(client, matchId);
  const playing = rsvps.filter((r) => r.status === "playing").length;
  return {
    ...match,
    playing,
    waitlisted: rsvps.filter((r) => r.status === "waitlist").length,
    spotsLeft: Math.max(0, match.capacity - playing),
  };
}

/** Which Team a player is on. */
export type Side = "A" | "B";

export interface TeamPlayer {
  membershipId: string;
  displayName: string;
}

export interface MatchTeams {
  state: "draft" | "published";
  /** Bumped each time published Teams change after a confirmed fix. */
  revision: number;
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

export async function getPairRules(client: SupabaseClient, groupId: string): Promise<Rules> {
  const { data, error } = await client
    .from("pair_rules")
    .select("a_membership_id, b_membership_id, kind")
    .eq("group_id", groupId);
  if (error) throw new Error(error.message);
  const pairs = (kind: string) =>
    (data ?? []).filter((r) => r.kind === kind).map((r): [string, string] => [r.a_membership_id, r.b_membership_id]);
  return { together: pairs("together"), apart: pairs("apart") };
}

/** Mean Rating of the Squad, rounded: what an unrated Guest is assumed to be worth. */
function averageRating(squad: SquadMember[]): number {
  const ratings = squad.flatMap((m) => (m.rating === undefined ? [] : [m.rating]));
  return ratings.length === 0 ? 50 : Math.round(ratings.reduce((a, b) => a + b, 0) / ratings.length);
}

/** The given players (Squad members and Guests) with everything the generator needs. Admin-only: Ratings are invisible to anyone else. */
export async function ratedPlayers(client: SupabaseClient, match: Match, ids: Set<string>): Promise<Player[]> {
  const [squad, guests] = await Promise.all([getSquad(client, match.groupId), getGuests(client, match.id)]);
  const members = squad
    .filter((m) => ids.has(m.id))
    .map((m) => {
      if (m.rating === undefined) throw new Error("only an admin can generate teams");
      return {
        id: m.id,
        rating: m.rating,
        happyInGoal: m.happyInGoal,
        ...(m.position ? { position: m.position } : {}),
      };
    });
  const guestPlayers = guests
    .filter((g) => ids.has(g.id))
    .map((g) => {
      if (g.effectiveRating === undefined) throw new Error("only an admin can generate teams");
      return { id: g.id, rating: g.effectiveRating };
    });
  return [...members, ...guestPlayers];
}

async function playingPlayers(client: SupabaseClient, match: Match): Promise<Player[]> {
  const rsvps = await getMatchRsvps(client, match.id);
  return ratedPlayers(client, match, new Set(rsvps.filter((r) => r.status === "playing").map((r) => r.membershipId)));
}

async function rankedSplits(client: SupabaseClient, matchId: string, limit: number) {
  const match = await fetchMatch(client, matchId);
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
  const [{ data: rows, error }, { data: team, error: teamError }] = await Promise.all([
    client.from("team_players").select("membership_id, side").eq("match_id", matchId),
    client.from("teams").select("rank").eq("match_id", matchId).maybeSingle(),
  ]);
  if (error || teamError) throw new Error((error ?? teamError)!.message);
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
  const { data: team, error } = await client.from("teams").select("state, revision").eq("match_id", matchId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!team) return null;
  const { data, error: playersError } = await client
    .from("team_players")
    .select("side, membership_id, memberships(display_name)")
    .eq("match_id", matchId);
  if (playersError) throw new Error(playersError.message);
  const side = (which: Side) =>
    (data ?? [])
      .filter((r) => r.side === which)
      .map((r) => ({
        membershipId: r.membership_id,
        displayName: (r.memberships as unknown as { display_name: string }).display_name,
      }));
  return { state: team.state, revision: team.revision, teamA: side("A"), teamB: side("B") };
}

export async function setPosition(
  client: SupabaseClient,
  membershipId: string,
  position: "GK" | "defender" | "attacker" | null,
): Promise<void> {
  await command(client, "set_position", { p_membership: membershipId, p_position: position });
}

/** Replaces the invite token, so the old link stops working. */
export function regenerateInvite(client: SupabaseClient, groupId: string): Promise<string> {
  return command(client, "regenerate_invite", { p_group: groupId });
}

export interface Guest {
  id: string;
  displayName: string;
  sponsorName: string | null;
  /** Admin-only: set by an Admin, otherwise absent. */
  rating?: number;
  /** Admin-only: the Rating team generation will use (the Group average until an Admin sets one). */
  effectiveRating?: number;
}

/** Add a Guest to a Match: takes a Capacity slot, or a Waitlist place if the Match is full. */
export function addGuest(client: SupabaseClient, matchId: string, name: string): Promise<string> {
  return command(client, "add_guest", { p_match: matchId, p_name: name });
}

export async function removeGuest(client: SupabaseClient, guestId: string): Promise<void> {
  await command(client, "remove_guest", { p_guest: guestId });
}

export async function promoteGuest(client: SupabaseClient, guestId: string): Promise<void> {
  await command(client, "promote_guest", { p_guest: guestId });
}

export async function getGuests(client: SupabaseClient, matchId: string): Promise<Guest[]> {
  const match = await fetchMatch(client, matchId);
  const { data, error } = await client
    .from("memberships")
    .select("id, display_name, sponsor:sponsor_membership_id(display_name), membership_ratings(rating)")
    .eq("guest_match_id", matchId)
    .eq("departed", false)
    .order("created_at");
  if (error) throw new Error(error.message);
  const average = (await isAdmin(client, match.groupId)) ? averageRating(await getSquad(client, match.groupId)) : undefined;
  return (data ?? []).map((row) => {
    const rating = (row.membership_ratings as unknown as { rating: number } | null)?.rating;
    return {
      id: row.id,
      displayName: row.display_name,
      sponsorName: (row.sponsor as unknown as { display_name: string } | null)?.display_name ?? null,
      ...(rating === undefined ? {} : { rating }),
      ...(average === undefined ? {} : { effectiveRating: rating ?? average }),
    };
  });
}

export interface FixProposal {
  /** Identifies this proposal, so a dismissed one is not offered again. */
  key: string;
  /** Players on the published Teams who are no longer in. */
  vacated: TeamPlayer[];
  /** Waitlisted players taking a vacated slot (first in the queue first), on the side they join. */
  promoted: (TeamPlayer & { side: Side })[];
  /** Players switching Team to rebalance (only when the Waitlist cannot fill every vacated slot). */
  moved: (TeamPlayer & { from: Side; to: Side })[];
  /** The Teams as they would be after the fix. */
  teamA: TeamPlayer[];
  teamB: TeamPlayer[];
  balance: number;
}

/**
 * After a dropout from published Teams: promote the first waitlisted player into each vacated slot; if the
 * Waitlist runs out, move the fewest players needed to rebalance. Null when nobody has dropped out, or the
 * Admin dismissed this exact proposal. Nothing changes until `confirmFix`.
 */
export async function getProposedFix(client: SupabaseClient, matchId: string): Promise<FixProposal | null> {
  const match = await fetchMatch(client, matchId);
  if (!(await isAdmin(client, match.groupId))) throw new Error("only an admin can see proposed fixes");
  if (match.status !== "teams_published") return null;

  const [teams, rsvps, dismissed] = await Promise.all([
    getTeams(client, matchId),
    getMatchRsvps(client, matchId),
    client.from("teams").select("dismissed_fix_key").eq("match_id", matchId).maybeSingle(),
  ]);
  if (!teams) return null;
  const rsvpOf = new Map(rsvps.map((r) => [r.membershipId, r]));
  const onTeams = [
    ...teams.teamA.map((p) => ({ ...p, side: "A" as Side })),
    ...teams.teamB.map((p) => ({ ...p, side: "B" as Side })),
  ];
  const vacated = onTeams.filter((p) => rsvpOf.get(p.membershipId)?.status !== "playing");
  if (vacated.length === 0) return null;

  const queue = rsvps
    .filter((r) => r.status === "waitlist")
    .sort((x, y) => x.waitlistPosition! - y.waitlistPosition!);
  const promoted = vacated.slice(0, queue.length).map((slot, i) => ({
    membershipId: queue[i]!.membershipId,
    displayName: queue[i]!.displayName,
    side: slot.side,
  }));
  const working = [...onTeams.filter((p) => !vacated.includes(p)), ...promoted];
  const sideOf = new Map(working.map((p) => [p.membershipId, p.side]));
  const unfilled = vacated.length - promoted.length;

  const players = await ratedPlayers(client, match, new Set(sideOf.keys()));
  const rules = await getPairRules(client, match.groupId);
  const idsOn = (side: Side) => working.filter((p) => p.side === side).map((p) => p.membershipId);
  let teamA = idsOn("A");
  let teamB = idsOn("B");
  const moved: FixProposal["moved"] = [];
  if (unfilled > 0 && players.length >= 2) {
    const [best] = generateTeams(players, rules, { keepCloseTo: { teamA, teamB }, limit: 1 });
    teamA = best!.teamA;
    teamB = best!.teamB;
    for (const p of working) {
      const to = teamA.includes(p.membershipId) ? "A" : "B";
      if (to !== p.side) moved.push({ membershipId: p.membershipId, displayName: p.displayName, from: p.side, to });
    }
  }

  const name = new Map([...onTeams, ...promoted].map((p) => [p.membershipId, p.displayName]));
  const person = (id: string): TeamPlayer => ({ membershipId: id, displayName: name.get(id)! });
  const key = [
    vacated.map((p) => p.membershipId).sort().join(","),
    promoted.map((p) => p.membershipId).sort().join(","),
  ].join(">");
  if (dismissed.data?.dismissed_fix_key === key) return null;

  return {
    key,
    vacated: vacated.map(({ membershipId, displayName }) => ({ membershipId, displayName })),
    // A rebalance can move a player who was just promoted, so report where they end up.
    promoted: promoted.map((p) => ({ ...p, side: teamA.includes(p.membershipId) ? ("A" as const) : ("B" as const) })),
    moved,
    teamA: teamA.map(person),
    teamB: teamB.map(person),
    balance: scoreSplit(players, rules, teamA, teamB).balance,
  };
}

/** Apply a proposed fix. The database re-checks it, so a hand-edited fix that skips the Waitlist is refused. */
export async function confirmFix(client: SupabaseClient, matchId: string, fix: FixProposal): Promise<void> {
  await command(client, "confirm_fix", {
    p_match: matchId,
    p_team_a: fix.teamA.map((p) => p.membershipId),
    p_team_b: fix.teamB.map((p) => p.membershipId),
  });
}

/**
 * An Admin rearranging the same players on published Teams. Players are told, and the revision goes up. A dropout is
 * dealt with by `confirmFix` first; the database refuses to add or remove anyone here.
 */
export async function changePublishedTeams(
  client: SupabaseClient,
  matchId: string,
  teams: { teamA: string[]; teamB: string[] },
): Promise<void> {
  await command(client, "change_published_teams", { p_match: matchId, p_team_a: teams.teamA, p_team_b: teams.teamB });
}

export async function dismissFix(client: SupabaseClient, matchId: string, fix: FixProposal): Promise<void> {
  await command(client, "dismiss_fix", { p_match: matchId, p_key: fix.key });
}

export interface GroupInfo {
  id: string;
  name: string;
  minPlayers: number;
  showTeamStrength: boolean;
  /** IANA time zone used to show Match times that did not come from a recurring template. */
  timeZone: string;
  myRole: MemberRole;
}

export async function getGroup(client: SupabaseClient, groupId: string): Promise<GroupInfo> {
  const { data, error } = await client
    .from("groups")
    .select("id, name, min_players, show_team_strength, timezone")
    .eq("id", groupId)
    .single();
  if (error) throw new Error(error.message);
  const myRole = await command<MemberRole>(client, "my_group_role", { p_group: groupId });
  return {
    id: data.id,
    name: data.name,
    minPlayers: data.min_players,
    showTeamStrength: data.show_team_strength,
    timeZone: data.timezone,
    myRole,
  };
}

export async function getMyGroups(client: SupabaseClient): Promise<{ id: string; name: string; myRole: MemberRole }[]> {
  const rows = await command<{ id: string; name: string; my_role: MemberRole }[]>(client, "my_groups", {});
  return rows.map((r) => ({ id: r.id, name: r.name, myRole: r.my_role }));
}

/** Change any of the Group's name, minimum-players threshold or whether players see team strength. */
export async function updateGroup(
  client: SupabaseClient,
  groupId: string,
  changes: { name?: string; minPlayers?: number; showTeamStrength?: boolean; timeZone?: string },
): Promise<void> {
  await command(client, "update_group", {
    p_group: groupId,
    p_name: changes.name ?? null,
    p_min_players: changes.minPlayers ?? null,
    p_show_team_strength: changes.showTeamStrength ?? null,
    p_timezone: changes.timeZone ?? null,
  });
}

export async function promoteToAdmin(client: SupabaseClient, membershipId: string): Promise<void> {
  await command(client, "promote_admin", { p_membership: membershipId });
}

export async function demoteAdmin(client: SupabaseClient, membershipId: string): Promise<void> {
  await command(client, "demote_admin", { p_membership: membershipId });
}

export async function transferOwnership(client: SupabaseClient, toMembershipId: string): Promise<void> {
  await command(client, "transfer_ownership", { p_to: toMembershipId });
}

export async function deleteGroup(client: SupabaseClient, groupId: string): Promise<void> {
  await command(client, "delete_group", { p_group: groupId });
}

/** Edit one Match. Anything left out keeps its current value; `rsvpDeadline: null` removes the deadline. */
export async function updateMatch(
  client: SupabaseClient,
  matchId: string,
  changes: { startsAt?: Date; capacity?: number; costPerPlayer?: number; rsvpDeadline?: Date | null },
): Promise<void> {
  await command(client, "update_match", {
    p_match: matchId,
    p_starts_at: changes.startsAt?.toISOString() ?? null,
    p_capacity: changes.capacity ?? null,
    p_cost: changes.costPerPlayer ?? null,
    p_rsvp_deadline: changes.rsvpDeadline?.toISOString() ?? null,
    p_clear_deadline: changes.rsvpDeadline === null,
  });
}

export async function cancelMatch(client: SupabaseClient, matchId: string): Promise<void> {
  await command(client, "cancel_match", { p_match: matchId });
}

export interface MatchResult {
  scoreA: number;
  scoreB: number;
}

export interface OwnRecord {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  /** Matches the Group has played in total, so "played" can be shown as attendance. */
  groupMatches: number;
}

export interface AttendanceRow {
  membershipId: string;
  displayName: string;
  played: number;
}

/** Record the score, or correct a mistyped one. The Match becomes "played". */
export async function recordResult(client: SupabaseClient, matchId: string, result: MatchResult): Promise<void> {
  await command(client, "record_result", { p_match: matchId, p_score_a: result.scoreA, p_score_b: result.scoreB });
}

export async function getResult(client: SupabaseClient, matchId: string): Promise<MatchResult | null> {
  const { data, error } = await client.from("results").select("score_a, score_b").eq("match_id", matchId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { scoreA: data.score_a, scoreB: data.score_b } : null;
}

export async function getOwnRecord(client: SupabaseClient, groupId: string): Promise<OwnRecord> {
  const [row] = await command<
    { played: number; won: number; drawn: number; lost: number; group_matches: number }[]
  >(client, "my_record", { p_group: groupId });
  return {
    played: row!.played,
    won: row!.won,
    drawn: row!.drawn,
    lost: row!.lost,
    groupMatches: row!.group_matches,
  };
}

/** How many Matches each member has played. Never wins or Ratings: that would invite arguments. */
export async function getAttendanceBoard(client: SupabaseClient, groupId: string): Promise<AttendanceRow[]> {
  const rows = await command<{ membership_id: string; display_name: string; played: number }[]>(
    client,
    "attendance_board",
    { p_group: groupId },
  );
  return rows.map((r) => ({ membershipId: r.membership_id, displayName: r.display_name, played: r.played }));
}

/** Admin removes a member. Their identity is erased but past appearances stay, anonymised ("Former player"). */
export async function removeMembership(client: SupabaseClient, membershipId: string): Promise<void> {
  await command(client, "remove_membership", { p_membership: membershipId });
}

/** Leave a Group at any time (the Owner must transfer ownership or delete the Group first). */
export async function leaveGroup(client: SupabaseClient, groupId: string): Promise<void> {
  await command(client, "leave_group", { p_group: groupId });
}

/** Erase the Person and anonymise their history in every Group. */
export async function deleteAccount(client: SupabaseClient): Promise<void> {
  await command(client, "delete_account", {});
}

export interface Venue extends VenueSummary {
  defaultCost: number;
}

export function createVenue(
  client: SupabaseClient,
  groupId: string,
  venue: { name: string; address?: string; mapsUrl?: string; defaultCost?: number },
): Promise<string> {
  return command(client, "create_venue", {
    p_group: groupId,
    p_name: venue.name,
    p_address: venue.address ?? null,
    p_maps_url: venue.mapsUrl ?? null,
    p_default_cost: venue.defaultCost ?? 0,
  });
}

/** Use the saved Venue with this name (ignoring case and spacing), or save it as new. */
export function findOrCreateVenue(client: SupabaseClient, groupId: string, name: string): Promise<string> {
  return command(client, "find_or_create_venue", { p_group: groupId, p_name: name });
}

export async function updateVenue(
  client: SupabaseClient,
  venueId: string,
  changes: { name?: string; address?: string | null; mapsUrl?: string | null; defaultCost?: number },
): Promise<void> {
  // Left out keeps the current value; null removes it.
  await command(client, "update_venue", {
    p_venue: venueId,
    p_name: changes.name ?? null,
    p_address: changes.address ?? null,
    p_maps_url: changes.mapsUrl ?? null,
    p_default_cost: changes.defaultCost ?? null,
    p_clear_address: changes.address === null,
    p_clear_maps_url: changes.mapsUrl === null,
  });
}

export async function getVenues(client: SupabaseClient, groupId: string): Promise<Venue[]> {
  const { data, error } = await client
    .from("venues")
    .select("id, name, address, maps_url, default_cost")
    .eq("group_id", groupId)
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((v) => ({
    id: v.id,
    name: v.name,
    address: v.address,
    mapsUrl: v.maps_url,
    defaultCost: Number(v.default_cost),
  }));
}

/** Set a Match's Venue, or pass null to clear it. */
export async function setMatchVenue(client: SupabaseClient, matchId: string, venueId: string | null): Promise<void> {
  await command(client, "set_match_venue", { p_match: matchId, p_venue: venueId });
}

export interface RecurringTemplate {
  /** 0 = Sunday ... 6 = Saturday, in the template's time zone. */
  weekday: number;
  /** "HH:MM", in the template's time zone. */
  startTime: string;
  timezone: string;
  venueId: string | null;
  capacity: number;
  /** Null means "use the Venue's default cost". */
  costPerPlayer: number | null;
  /** How many days before kick-off RSVPs open. */
  rsvpLeadDays: number;
  /** Hours before kick-off that RSVPs close; null means no deadline. */
  rsvpDeadlineHoursBefore: number | null;
  paused: boolean;
}

/**
 * Create or edit the Group's weekly template (there is at most one). Saving creates next week's Match
 * straight away; changes apply to Matches made afterwards, not ones that already exist.
 */
export async function saveRecurringTemplate(
  client: SupabaseClient,
  groupId: string,
  template: {
    weekday: number;
    startTime: string;
    timezone: string;
    venueId?: string;
    capacity?: number;
    costPerPlayer?: number;
    rsvpLeadDays?: number;
    /** Hours before kick-off that RSVPs close. Defaults to 24; pass null for no deadline. */
    rsvpDeadlineHoursBefore?: number | null;
  },
): Promise<void> {
  await command(client, "save_recurring_template", {
    p_group: groupId,
    p_weekday: template.weekday,
    p_start_time: template.startTime,
    p_timezone: template.timezone,
    p_venue: template.venueId ?? null,
    p_capacity: template.capacity ?? 10,
    p_cost: template.costPerPlayer ?? null,
    p_lead_days: template.rsvpLeadDays ?? 3,
    p_deadline_hours: template.rsvpDeadlineHoursBefore === undefined ? 24 : template.rsvpDeadlineHoursBefore,
  });
}

/** Pause for a summer break, or resume. A paused template makes no Matches and opens no RSVPs. */
export async function setRecurringPaused(client: SupabaseClient, groupId: string, paused: boolean): Promise<void> {
  await command(client, "set_recurring_paused", { p_group: groupId, p_paused: paused });
}

export async function getRecurringTemplate(client: SupabaseClient, groupId: string): Promise<RecurringTemplate | null> {
  const { data, error } = await client
    .from("recurring_templates")
    .select("weekday, start_time, timezone, venue_id, capacity, cost_per_player, rsvp_lead_days, rsvp_deadline_hours_before, paused")
    .eq("group_id", groupId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    weekday: data.weekday,
    startTime: data.start_time.slice(0, 5),
    timezone: data.timezone,
    venueId: data.venue_id,
    capacity: data.capacity,
    costPerPlayer: data.cost_per_player === null ? null : Number(data.cost_per_player),
    rsvpLeadDays: data.rsvp_lead_days,
    rsvpDeadlineHoursBefore: data.rsvp_deadline_hours_before,
    paused: data.paused,
  };
}
