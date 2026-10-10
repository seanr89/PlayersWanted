"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { browserClient } from "./supabase";

export interface SessionUser {
  id: string;
  email: string | null;
  /** Players join without an account; Admins sign in with an email link. */
  isAnonymous: boolean;
}

interface SessionValue {
  client: SupabaseClient;
  /** Null until we know, and null when signed out. */
  user: SessionUser | null;
  /** False until the stored session has been read. */
  ready: boolean;
  /** Signs in anonymously if nobody is signed in, so a player can open an invite link without an account. */
  ensureSignedIn: () => Promise<void>;
  sendMagicLink: (email: string, returnTo: string) => Promise<void>;
  /** Attaches an email to the current (anonymous) player, so they can sign in again on another device. */
  linkEmail: (email: string, returnTo: string) => Promise<{ needsConfirmation: boolean }>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const client = useMemo(() => browserClient(), []);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const toUser = (u: { id: string; email?: string; is_anonymous?: boolean } | undefined): SessionUser | null =>
      u ? { id: u.id, email: u.email || null, isAnonymous: u.is_anonymous === true } : null;

    client.auth.getSession().then(({ data }) => {
      setUser(toUser(data.session?.user));
      setReady(true);
    });
    const { data } = client.auth.onAuthStateChange((_event, session) => setUser(toUser(session?.user)));
    return () => data.subscription.unsubscribe();
  }, [client]);

  const ensureSignedIn = useCallback(async () => {
    const { data } = await client.auth.getSession();
    if (data.session) return;
    const { error } = await client.auth.signInAnonymously();
    if (error) throw new Error(error.message);
  }, [client]);

  const sendMagicLink = useCallback(
    async (email: string, returnTo: string) => {
      const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: returnTo } });
      if (error) throw new Error(error.message);
    },
    [client],
  );

  const linkEmail = useCallback(
    async (email: string, returnTo: string) => {
      const { data, error } = await client.auth.updateUser({ email }, { emailRedirectTo: returnTo });
      if (error) throw new Error(error.message);
      // With confirmation on, the address is "pending" until they open the emailed link; otherwise it is saved now.
      return { needsConfirmation: data.user?.email !== email };
    },
    [client],
  );

  const signOut = useCallback(async () => {
    await client.auth.signOut();
  }, [client]);

  const value = useMemo(
    () => ({ client, user, ready, ensureSignedIn, sendMagicLink, linkEmail, signOut }),
    [client, user, ready, ensureSignedIn, sendMagicLink, linkEmail, signOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
