import { execFileSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Local Supabase defaults (public dev values). Override with the env vars in .env.example.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";

/** A fresh signed-in user. Anonymous auth stands in for Google/Apple/magic link: permissions come from Memberships, not the sign-in method. */
export async function newUser(): Promise<SupabaseClient> {
  const client = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInAnonymously();
  if (error) throw error;
  return client;
}

export const inAWeek = () => new Date(Date.now() + 7 * 24 * 3600 * 1000);

/** Index rows by display name, for readable assertions about who is playing or queued. */
export const byName = <T extends { displayName: string }>(rows: T[]): Record<string, T> =>
  Object.fromEntries(rows.map((r) => [r.displayName, r]));

/** Run SQL as the database owner inside the local Supabase container. Test setup only (e.g. forcing a match to 'played'). */
export function sql(query: string): string {
  return execFileSync("docker", ["exec", "supabase_db_PlayersWanted", "psql", "-U", "postgres", "-tAc", query], {
    encoding: "utf8",
  }).trim();
}

/**
 * Run the recurring-template job as the scheduler would, pretending it is `at`. Scoped to one group so tests
 * don't touch each other's data. Returns how many Matches it created.
 */
export function runRecurringJob(at: Date, groupId: string): number {
  return Number(sql(`select private.run_recurring_templates('${at.toISOString()}', '${groupId}')`));
}

/** Weekday (0 = Sunday) and hour:minute of an instant as seen in a time zone. */
export function localTime(instant: string | Date, timeZone: string): { weekday: number; time: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { weekday, time: `${get("hour")}:${get("minute")}` };
}
