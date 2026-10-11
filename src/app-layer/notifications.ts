import type { SupabaseClient } from "@supabase/supabase-js";
import { isAdmin } from "./index";

/**
 * Notifications and WhatsApp sharing.
 *
 * Commands record events in an outbox inside the same database transaction as the change (so an event is never
 * lost, nor sent for something that rolled back). `dispatchNotifications` is the delivery worker: it claims
 * pending events with the service role and hands each one to every channel. Web push and email are channels
 * behind the same interface, so they can be added without touching any caller. WhatsApp is not a channel: it
 * is a prefilled message an Admin shares by hand (`getShareMessage`).
 */

export type NotificationKind =
  | "rsvps_opened"
  | "match_at_risk"
  | "teams_published"
  | "teams_changed"
  | "match_cancelled";

export interface Recipient {
  personId: string;
  membershipId: string;
  displayName: string;
  /** For channels that need the account (e.g. looking up an email address). Null for people without one. */
  authUserId: string | null;
  isAdmin: boolean;
}

export interface Notification {
  kind: NotificationKind;
  groupId: string;
  groupName: string;
  matchId: string | null;
  title: string;
  body: string;
  /** Link to open in the app. */
  url: string;
  payload: Record<string, unknown>;
  recipients: Recipient[];
}

/** One delivery route (web push, email, ...). Called once per event with everyone who should hear about it. */
export interface NotificationChannel {
  readonly name: string;
  send(notification: Notification): Promise<void>;
}

export interface DispatchResult {
  /** Events handed to the channels. */
  delivered: number;
  /** Events dropped because they were out of date by the time they were delivered. */
  skipped: number;
  failures: { channel: string; eventId: number; error: string }[];
}

interface ClaimedEvent {
  id: number;
  kind: NotificationKind;
  groupId: string;
  groupName: string;
  matchId: string | null;
  payload: Record<string, unknown>;
  recipients: Recipient[];
}

interface MessageContext {
  groupId: string;
  groupName: string;
  minPlayers: number;
  matchId: string;
  startsAt: string;
  timeZone: string;
  costPerPlayer: number;
  venueName: string | null;
  inCount: number;
  teams: { teamA: string[]; teamB: string[] } | null;
  teamsPublished: boolean;
  status: string;
}

const BATCH = 50;
const DEFAULT_TIME_BUDGET_MS = 45_000;
const MAX_BATCHES = 1000;

/** Where links point. In production the address must be configured: a localhost link in a message is useless. */
function appUrl(override?: string): string {
  const configured = override ?? process.env.NEXT_PUBLIC_APP_URL;
  if (configured === undefined && process.env.NODE_ENV === "production") {
    throw new Error("set NEXT_PUBLIC_APP_URL so messages can link to the app");
  }
  const base = configured ?? "http://localhost:3000";
  if (!/^https?:\/\/[^\s]+$/i.test(base)) throw new Error("the app URL must be an absolute http(s) address");
  return base.replace(/\/+$/, "");
}

const errorMessage = (e: unknown) => String(e instanceof Error ? e.message : e);

/**
 * Member-controlled text (names) goes into messages an Admin forwards to a whole chat. Flatten it to one plain
 * line: no newlines (which could forge extra lines), no WhatsApp formatting characters, and no links.
 */
function plain(text: string): string {
  return text
    .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
    .replace(/[*_~`]/g, "")
    .replace(/https?:\/\/\S*/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

const matchUrl = (base: string, matchId: string) => `${base}/matches/${matchId}`;

/** "Thu 14 Jan, 19:00" in the Group's time zone. */
function formatWhen(startsAt: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(startsAt));
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("weekday")} ${get("day")} ${get("month")}, ${get("hour")}:${get("minute")}`;
}

/** Reads what a message needs. Works for an Admin's client (row-level security) or the service role. */
async function loadContext(client: SupabaseClient, matchId: string): Promise<MessageContext> {
  const { data: match, error } = await client
    .from("matches")
    .select("id, group_id, starts_at, cost_per_player, status, venues(name)")
    .eq("id", matchId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!match) throw new Error("match not found");

  const [group, template, ins, state, players] = await Promise.all([
    client.from("groups").select("name, min_players, timezone").eq("id", match.group_id).single(),
    client.from("recurring_templates").select("timezone").eq("group_id", match.group_id).maybeSingle(),
    client.from("rsvps").select("id", { count: "exact", head: true }).eq("match_id", matchId).eq("response", "in"),
    client.from("teams").select("state").eq("match_id", matchId).maybeSingle(),
    client.from("team_players").select("side, memberships(display_name)").eq("match_id", matchId),
  ]);
  if (group.error) throw new Error(group.error.message);

  const side = (which: "A" | "B") =>
    (players.data ?? [])
      .filter((p) => p.side === which)
      .map((p) => plain((p.memberships as unknown as { display_name: string }).display_name))
      .sort();
  const hasTeams = (players.data ?? []).length > 0;
  return {
    groupId: match.group_id,
    groupName: plain(group.data.name),
    minPlayers: group.data.min_players,
    matchId,
    startsAt: match.starts_at,
    timeZone: template.data?.timezone ?? group.data.timezone,
    costPerPlayer: Number(match.cost_per_player),
    venueName: plain((match.venues as unknown as { name: string } | null)?.name ?? "") || null,
    status: match.status,
    inCount: ins.count ?? 0,
    teams: hasTeams ? { teamA: side("A"), teamB: side("B") } : null,
    teamsPublished: state.data?.state === "published",
  };
}

/** The wording for each kind of message. Never mentions Ratings: Teams are listed by name only. */
function compose(
  kind: NotificationKind,
  ctx: MessageContext,
  options: { includeTeams: boolean; reason?: unknown },
): { title: string; body: string } {
  const when = formatWhen(ctx.startsAt, ctx.timeZone);
  const where = ctx.venueName ? ` at ${ctx.venueName}` : "";
  // Listing the Teams in a push or email would show an unconfirmed claimant both sides, so those just say to open
  // the app. The Admin's WhatsApp message (which they choose to post to the chat) lists them.
  const teamLines = ctx.teams
    ? `Team A: ${ctx.teams.teamA.join(", ")}\nTeam B: ${ctx.teams.teamB.join(", ")}`
    : "";
  const openTheApp = "Open the app to see which side you're on.";
  switch (kind) {
    case "rsvps_opened": {
      const cost = ctx.costPerPlayer > 0 ? `\nCost: ${ctx.costPerPlayer.toFixed(2)} per player.` : "";
      return {
        title: `RSVPs are open for ${when}`,
        body: `${ctx.groupName}: ${when}${where}.${cost}\nTap to say you're in.`,
      };
    }
    case "match_at_risk": {
      const needed = Math.max(0, ctx.minPlayers - ctx.inCount);
      return {
        title: `Only ${ctx.inCount} in for ${when}`,
        body: `Only ${ctx.inCount} in for ${ctx.groupName}${where} (${when}). We need ${needed} more to make ${ctx.minPlayers}. Who's in?`,
      };
    }
    case "teams_published":
      return {
        title: `Teams are out for ${when}`,
        body: `Teams for ${ctx.groupName}${where} (${when}) are out.\n${options.includeTeams ? teamLines : openTheApp}`,
      };
    case "teams_changed": {
      const what =
        options.reason === "organiser_change"
          ? `The organiser has changed the teams for ${ctx.groupName} (${when}).`
          : `Someone dropped out, so the teams for ${ctx.groupName} (${when}) have changed.`;
      return {
        title: `Teams have changed for ${when}`,
        body: `${what}\n${options.includeTeams ? teamLines : openTheApp}`,
      };
    }
    case "match_cancelled":
      return { title: `Cancelled: ${when}`, body: `${ctx.groupName} on ${when}${where} is cancelled.` };
  }
}

export interface ShareMessage {
  text: string;
  /** The link inside the message. */
  url: string;
  /** Opens WhatsApp (or its share sheet) with the text prefilled. */
  whatsappUrl: string;
}

/**
 * A prefilled WhatsApp message for an Admin to share into the group chat at a key moment. There is no WhatsApp
 * integration: this is just text and a link, available any time (not only when an automatic event fired).
 */
export async function getShareMessage(
  client: SupabaseClient,
  matchId: string,
  kind: "rsvps_open" | "match_at_risk" | "teams_published",
  options: { appUrl?: string } = {},
): Promise<ShareMessage> {
  const ctx = await loadContext(client, matchId);
  if (!(await isAdmin(client, ctx.groupId))) throw new Error("only an admin can share match messages");
  if (ctx.status === "cancelled" || ctx.status === "played") throw new Error(`this match is ${ctx.status}`);
  if (kind === "teams_published" && !ctx.teamsPublished) throw new Error("the teams have not been published yet");
  if (kind === "match_at_risk" && ctx.inCount >= ctx.minPlayers) {
    throw new Error("this match already has enough players");
  }

  const eventKind: NotificationKind = kind === "rsvps_open" ? "rsvps_opened" : kind;
  const url = matchUrl(appUrl(options.appUrl), matchId);
  const text = `${compose(eventKind, ctx, { includeTeams: true }).body}\n${url}`;
  return { text, url, whatsappUrl: `https://wa.me/?text=${encodeURIComponent(text)}` };
}

/** An announcement that something is open or short of players means nothing once the Match is off or over. */
const isStale = (kind: NotificationKind, status: string) =>
  (kind === "rsvps_opened" || kind === "match_at_risk") && (status === "cancelled" || status === "played");

async function toNotification(service: SupabaseClient, event: ClaimedEvent, base: string): Promise<Notification | null> {
  if (!event.matchId) throw new Error("event has no match");
  const ctx = await loadContext(service, event.matchId);
  if (isStale(event.kind, ctx.status)) return null;
  const { title, body } = compose(event.kind, ctx, { includeTeams: false, reason: event.payload.reason });
  return {
    kind: event.kind,
    groupId: event.groupId,
    groupName: plain(event.groupName),
    matchId: event.matchId,
    title,
    body,
    url: matchUrl(base, event.matchId),
    payload: event.payload,
    recipients: event.recipients,
  };
}

/**
 * The delivery worker. Needs a service-role client: only that role may claim events. Each event is handed over
 * at most once; if a channel fails, the others still get the notification and the failure is reported.
 */
export async function dispatchNotifications(
  service: SupabaseClient,
  channels: NotificationChannel[],
  options: { appUrl?: string; timeBudgetMs?: number } = {},
): Promise<DispatchResult> {
  // Claiming events with nowhere to send them would lose them, so refuse before touching the outbox.
  if (channels.length === 0) throw new Error("no delivery channels configured");
  const base = appUrl(options.appUrl);
  const result: DispatchResult = { delivered: 0, skipped: 0, failures: [] };

  const started = Date.now();
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    // Stop claiming once the time is spent; anything left stays pending for the next run.
    if (Date.now() - started > (options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS)) break;
    const { data, error } = await service.rpc("claim_pending_notifications", { p_limit: BATCH });
    if (error) throw new Error(error.message);
    const events = data as ClaimedEvent[];
    if (events.length === 0) break;

    for (const event of events) {
      let notification: Notification | null;
      try {
        notification = await toNotification(service, event, base);
      } catch (e) {
        // E.g. the Match was deleted after the event was recorded: nothing left to tell anyone.
        result.failures.push({ channel: "(compose)", eventId: event.id, error: errorMessage(e) });
        continue;
      }
      if (!notification) {
        result.skipped++;
        continue;
      }
      result.delivered++;
      for (const channel of channels) {
        try {
          await channel.send(notification);
        } catch (e) {
          result.failures.push({ channel: channel.name, eventId: event.id, error: errorMessage(e) });
        }
      }
    }
  }
  return result;
}
