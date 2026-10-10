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
