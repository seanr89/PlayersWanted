"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { getMyMembership } from "../../../app-layer/views";
import { LoadingPage, TabBar } from "../../../ui/parts";
import { useSession } from "../../../ui/session";
import { useAsync } from "../../../ui/use-async";

/** Everything inside a Group: checks you belong to it, and adds the bottom tab bar. */
export default function GroupLayout({ children }: { children: ReactNode }) {
  const { groupId } = useParams<{ groupId: string }>();
  const { client, ready, user } = useSession();
  const router = useRouter();
  const me = useAsync(async () => (user ? getMyMembership(client, groupId) : null), [client, groupId, user?.id]);

  useEffect(() => {
    if (ready && !user) router.replace("/");
  }, [ready, user, router]);

  if (!ready || me.loading) return <LoadingPage />;
  if (me.error) {
    return (
      <main className="page no-tabs">
        <h1>We couldn&apos;t load this group</h1>
        <p>Check your connection and try again.</p>
        <button className="button block" onClick={() => void me.reload()}>
          Try again
        </button>
      </main>
    );
  }
  if (me.data === null) {
    return (
      <main className="page no-tabs">
        <h1>You&apos;re not in this group</h1>
        <p>Ask the organiser for the invite link, or check you&apos;re signed in on this device.</p>
        <Link className="button block" href="/">
          Back home
        </Link>
      </main>
    );
  }
  return (
    <>
      {children}
      <TabBar groupId={groupId} />
    </>
  );
}
