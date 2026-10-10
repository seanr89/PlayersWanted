"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { getMatch } from "../../../app-layer";
import { LoadingPage } from "../../../ui/parts";
import { useSession } from "../../../ui/session";
import { useAsync } from "../../../ui/use-async";

/** Links in notifications and shared messages point here; send people to the right Group. */
export default function MatchRedirect() {
  const { matchId } = useParams<{ matchId: string }>();
  const { client, ready, user } = useSession();
  const router = useRouter();
  const match = useAsync(async () => (ready && user ? getMatch(client, matchId) : undefined), [client, ready, user?.id, matchId]);

  useEffect(() => {
    if (match.data) router.replace(`/g/${match.data.groupId}`);
  }, [match.data, router]);

  if (!ready || match.loading) return <LoadingPage tabs={false} />;
  if (match.data) return <LoadingPage tabs={false} />;
  return (
    <main className="page no-tabs">
      <h1>Open the game</h1>
      {user ? (
        <p>We couldn&apos;t open that match. It may belong to a group you&apos;re not in.</p>
      ) : (
        <p>Open the invite link your organiser shared to join, or sign in if you&apos;ve been here before.</p>
      )}
      <div className="stack">
        <Link className="button block" href="/signin">
          Sign in
        </Link>
        <Link className="button quiet block" href="/">
          Back home
        </Link>
      </div>
    </main>
  );
}
