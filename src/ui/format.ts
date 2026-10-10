import type { MemberRole } from "../app-layer";

/** "Thu 15 Oct, 19:00" in the viewer's own time zone. */
export function formatWhen(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("weekday")} ${get("day")} ${get("month")}, ${get("hour")}:${get("minute")}`;
}

/** "2d 4h", "35m", or "Under a minute"; null once the time has passed. */
export function untilLabel(iso: string, now = Date.now()): string | null {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return null;
  const minutes = Math.floor(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return minutes > 0 ? `${minutes}m` : "Under a minute";
}

/** How a role is shown to people. */
export const ROLE_LABEL: Record<MemberRole, string> = { owner: "Owner", admin: "Admin", member: "Player" };

export const POSITION_LABEL = { GK: "Goalkeeper", defender: "Defender", attacker: "Attacker" } as const;

/** What a match's status means to someone looking at the list. */
export const MATCH_STATUS_LABEL = {
  scheduled: "RSVPs not open",
  rsvps_open: "RSVPs open",
  teams_published: "Teams out",
  played: "Played",
  cancelled: "Cancelled",
} as const;

/** Statuses in which people can still say in or out. */
export const RSVPS_ACCEPTED = ["rsvps_open", "teams_published"] as const;

/** A link we are willing to put in an `href`: web addresses only, never `javascript:` or similar. */
export const safeHref = (url: string | null | undefined): string | undefined =>
  url && /^https?:\/\//i.test(url) ? url : undefined;
