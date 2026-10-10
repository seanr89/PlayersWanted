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
