import type { SupabaseClient } from "@supabase/supabase-js";
import type { Player, Rules } from "../team-generator";
import {
  fetchMatch,
  getGroup,
  getMatchRsvps,
  getMatches,
  getPairRules,
  getPendingClaims,
  getProposedFix,
  getTeams,
  isAdmin,
  ratedPlayers,
  type ClaimState,
  type Match,
  type MatchTeams,
  type MemberRole,
} from "./index";

/**
 * Read models shaped per role: what a screen needs in one call, with admin-only fields present only for Admins.
 */

/** Owners and Admins have organiser powers. */
export const isAdminRole = (role: MemberRole | undefined | null): boolean => role === "owner" || role === "admin";

export interface MyMembership {
  id: string;
  displayName: string;
  role: MemberRole;
  claim: ClaimState;
}

/** The caller's own Membership in a Group, or null if they are not in it. */
export async function getMyMembership(client: SupabaseClient, groupId: string): Promise<MyMembership | null> {
  const { data, error } = await client.rpc("my_membership", { p_group: groupId });
  if (error) throw new Error(error.message);
  const row = (data as { id: string; display_name: string; role: MemberRole; claim: ClaimState }[])[0];
  return row ? { id: row.id, displayName: row.display_name, role: row.role, claim: row.claim } : null;
}

export type NextAction =
  | "create_match"
  | "open_rsvps"
  | "nudge"
  | "generate_teams"
  | "publish_teams"
  | "redo_teams"
  | "review_dropout"
  | "record_result"
  | "nothing";

export interface WhosIn {
  membershipId: string;
  displayName: string;
  isGuest: boolean;
  status: "playing" | "waitlist";
  waitlistPosition?: number;
}

export interface NextMatchView {
  me: MyMembership;
  groupName: string;
  minPlayers: number;
  match: Match | null;
  counts: { playing: number; waitlisted: number; spotsLeft: number };
  myRsvp: { response: "in" | "out" | null; status: "playing" | "waitlist" | "out" | null; waitlistPosition?: number };
  whosIn: WhosIn[];
  /** What this user is allowed to see: a draft is Admin-only, a published side may be just my own. */
  teams: MatchTeams | null;
  myTeam: "A" | "B" | null;
  /** Present only for Admins. */
  admin?: {
    nextAction: NextAction;
    inCount: number;
    belowMinimum: boolean;
    pendingClaims: number;
    /** A draft exists but someone has dropped out or joined since it was made. */
    draftStale: boolean;
  };
}

/** A match that started this long ago and is still unfinished is treated as forgotten, not "next". */
const FORGOTTEN_AFTER_MS = 12 * 3600_000;

/**
 * The earliest unfinished match. Players stop seeing one that started long ago, but an Admin keeps seeing a match
 * with published Teams until its result is recorded (or it is cancelled), so it is never stranded.
 */
function pickNext(matches: Match[], admin: boolean): Match | null {
  const cutoff = Date.now() - FORGOTTEN_AFTER_MS;
  return (
    matches
      .filter((m) => ["scheduled", "rsvps_open", "teams_published"].includes(m.status))
      .filter((m) => new Date(m.startsAt).getTime() > cutoff || (admin && m.status === "teams_published"))
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0] ?? null
  );
}

export async function getNextMatchView(client: SupabaseClient, groupId: string): Promise<NextMatchView> {
  const [me, group, matches] = await Promise.all([getMyMembership(client, groupId), getGroup(client, groupId), getMatches(client, groupId)]);
  if (!me) throw new Error("you are not in this group");
  const admin = isAdminRole(me.role);
  const match = pickNext(matches, admin);
  const pendingClaims = admin ? (await getPendingClaims(client, groupId)).length : 0;

  const base = { me, groupName: group.name, minPlayers: group.minPlayers };
  if (!match) {
    return {
      ...base,
      match: null,
      counts: { playing: 0, waitlisted: 0, spotsLeft: 0 },
      myRsvp: { response: null, status: null },
      whosIn: [],
      teams: null,
      myTeam: null,
      ...(admin
        ? { admin: { nextAction: "create_match" as const, inCount: 0, belowMinimum: false, pendingClaims, draftStale: false } }
        : {}),
    };
  }

  const [rsvps, teams] = await Promise.all([getMatchRsvps(client, match.id), getTeams(client, match.id)]);
  const playing = rsvps.filter((r) => r.status === "playing").length;
  const waitlisted = rsvps.filter((r) => r.status === "waitlist").length;
  const mine = rsvps.find((r) => r.membershipId === me.id);
  const myTeam =
    teams?.state === "published"
      ? teams.teamA.some((p) => p.membershipId === me.id)
        ? "A"
        : teams.teamB.some((p) => p.membershipId === me.id)
          ? "B"
          : null
      : null;

  const view: NextMatchView = {
    ...base,
    match,
    counts: { playing, waitlisted, spotsLeft: Math.max(0, match.capacity - playing) },
    myRsvp: mine
      ? { response: mine.response, status: mine.status, ...(mine.waitlistPosition ? { waitlistPosition: mine.waitlistPosition } : {}) }
      : { response: null, status: null },
    whosIn: rsvps
      .filter((r) => r.response === "in")
      .map((r) => ({
        membershipId: r.membershipId,
        displayName: r.displayName,
        isGuest: r.isGuest,
        status: r.status === "waitlist" ? "waitlist" : "playing",
        ...(r.waitlistPosition ? { waitlistPosition: r.waitlistPosition } : {}),
      })),
    teams,
    myTeam,
  };

  if (admin) {
    const inCount = playing + waitlisted;
    const playingIds = new Set(rsvps.filter((r) => r.status === "playing").map((r) => r.membershipId));
    const onTeams = [...(teams?.teamA ?? []), ...(teams?.teamB ?? [])].map((p) => p.membershipId);
    const draftStale = teams?.state === "draft" && !(onTeams.length === playingIds.size && onTeams.every((id) => playingIds.has(id)));
    view.admin = {
      nextAction: await nextAction(client, match, teams, inCount, group.minPlayers, draftStale),
      inCount,
      belowMinimum: inCount < group.minPlayers,
      pendingClaims,
      draftStale,
    };
  }
  return view;
}

async function nextAction(
  client: SupabaseClient,
  match: Match,
  teams: MatchTeams | null,
  inCount: number,
  minPlayers: number,
  draftStale: boolean,
): Promise<NextAction> {
  switch (match.status) {
    case "scheduled":
      return "open_rsvps";
    case "rsvps_open":
      if (teams?.state === "draft") return draftStale ? "redo_teams" : "publish_teams";
      return inCount < minPlayers ? "nudge" : "generate_teams";
    case "teams_published":
      if (await getProposedFix(client, match.id)) return "review_dropout";
      return new Date(match.startsAt).getTime() <= Date.now() ? "record_result" : "nothing";
    default:
      return "nothing";
  }
}

export interface AssignedPlayer {
  membershipId: string;
  displayName: string;
  /** Null only for someone who has left since Teams were published: they have no Rating to show. */
  rating: number | null;
  position: Player["position"] | null;
  happyInGoal: boolean;
  isGuest: boolean;
}

export interface TeamAssignmentView {
  match: Match;
  /** "none" before any Teams are made. */
  state: "none" | "draft" | "published";
  teamA: AssignedPlayer[];
  teamB: AssignedPlayer[];
  /** Everything the generator needs to score any arrangement on the device (the live Balance meter). */
  players: Player[];
  rules: Rules;
  /** Where in the generator's ranked list the current suggestion came from (0 = best). */
  rank: number;
  /** A draft that no longer matches who is playing: someone dropped out or joined since it was made. */
  stale: boolean;
  /** Published Teams that still list someone who dropped out: the dropout fix has to come before any other change. */
  needsFix: boolean;
}

/** Admin-only: it carries Ratings. Everything the team-assignment screen shows and needs to score a swap. */
export async function getTeamAssignmentView(client: SupabaseClient, matchId: string): Promise<TeamAssignmentView> {
  const match = await fetchMatch(client, matchId);
  if (!(await isAdmin(client, match.groupId))) throw new Error("only an admin can see the team assignment");

  const [rsvps, teams, rules, rankRow] = await Promise.all([
    getMatchRsvps(client, matchId),
    getTeams(client, matchId),
    getPairRules(client, match.groupId),
    client.from("teams").select("rank").eq("match_id", matchId).maybeSingle(),
  ]);
  if (rankRow.error) throw new Error(rankRow.error.message);
  const playing = new Set(rsvps.filter((r) => r.status === "playing").map((r) => r.membershipId));
  const onTeams = new Set([...(teams?.teamA ?? []), ...(teams?.teamB ?? [])].map((p) => p.membershipId));
  const players = await ratedPlayers(client, match, new Set([...playing, ...onTeams]));
  const known = new Map(players.map((p) => [p.id, p]));
  const guests = new Set(rsvps.filter((r) => r.isGuest).map((r) => r.membershipId));

  const assigned = (side: { membershipId: string; displayName: string }[]): AssignedPlayer[] =>
    side.map(({ membershipId, displayName }) => {
      const p = known.get(membershipId);
      return {
        membershipId,
        displayName,
        rating: p?.rating ?? null,
        position: p?.position ?? null,
        happyInGoal: p?.happyInGoal ?? false,
        isGuest: guests.has(membershipId),
      };
    });

  const state = teams?.state ?? "none";
  const sameAsPlaying = onTeams.size === playing.size && [...onTeams].every((id) => playing.has(id));
  return {
    match,
    state,
    teamA: assigned(teams?.teamA ?? []),
    teamB: assigned(teams?.teamB ?? []),
    players: players.filter((p) => playing.has(p.id) || onTeams.has(p.id)),
    rules,
    rank: rankRow.data?.rank ?? 0,
    stale: state === "draft" && !sameAsPlaying,
    needsFix: state === "published" && [...onTeams].some((id) => !playing.has(id)),
  };
}
