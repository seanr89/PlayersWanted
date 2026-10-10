import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getGroup,
  getMatchRsvps,
  getMatches,
  getPendingClaims,
  getProposedFix,
  getTeams,
  type ClaimState,
  type Match,
  type MatchTeams,
  type MemberRole,
} from "./index";

/**
 * Read models shaped per role: what a screen needs in one call, with admin-only fields present only for Admins.
 */

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
  admin?: { nextAction: NextAction; inCount: number; belowMinimum: boolean; pendingClaims: number };
}

/** A match that started this long ago and is still unfinished is treated as forgotten, not "next". */
const FORGOTTEN_AFTER_MS = 12 * 3600_000;

function pickNext(matches: Match[]): Match | null {
  const cutoff = Date.now() - FORGOTTEN_AFTER_MS;
  return (
    matches
      .filter((m) => ["scheduled", "rsvps_open", "teams_published"].includes(m.status))
      .filter((m) => new Date(m.startsAt).getTime() > cutoff)
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0] ?? null
  );
}

export async function getNextMatchView(client: SupabaseClient, groupId: string): Promise<NextMatchView> {
  const [me, group, matches] = await Promise.all([getMyMembership(client, groupId), getGroup(client, groupId), getMatches(client, groupId)]);
  if (!me) throw new Error("you are not in this group");
  const admin = me.role === "owner" || me.role === "admin";
  const match = pickNext(matches);
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
      ...(admin ? { admin: { nextAction: "create_match" as const, inCount: 0, belowMinimum: false, pendingClaims } } : {}),
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
    view.admin = {
      nextAction: await nextAction(client, match, teams, inCount, group.minPlayers),
      inCount,
      belowMinimum: inCount < group.minPlayers,
      pendingClaims,
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
): Promise<NextAction> {
  switch (match.status) {
    case "scheduled":
      return "open_rsvps";
    case "rsvps_open":
      if (teams?.state === "draft") return "publish_teams";
      return inCount < minPlayers ? "nudge" : "generate_teams";
    case "teams_published":
      if (await getProposedFix(client, match.id)) return "review_dropout";
      return new Date(match.startsAt).getTime() <= Date.now() ? "record_result" : "nothing";
    default:
      return "nothing";
  }
}
