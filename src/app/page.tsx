"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { getMyGroups } from "../app-layer";
import { ROLE_LABEL } from "../ui/format";
import { ErrorNote, LoadingPage, useTitle } from "../ui/parts";
import { useSession } from "../ui/session";
import { useAsync } from "../ui/use-async";

export default function Home() {
  const { client, ready, user } = useSession();
  const router = useRouter();
  const groups = useAsync(async () => (user ? getMyGroups(client) : []), [client, user?.id]);
  useTitle("Bibleague");

  useEffect(() => {
    if (groups.data?.length === 1) router.replace(`/g/${groups.data[0]!.id}`);
  }, [groups.data, router]);

  if (!ready || groups.loading || groups.data?.length === 1) return <LoadingPage tabs={false} />;

  return (
    <main className="page no-tabs pitch">
      <h1>Bibleague</h1>
      <ErrorNote message={groups.error} />
      {groups.data && groups.data.length > 1 ? (
        <div className="stack">
          <h2>Your games</h2>
          <ul className="list" role="list">
            {groups.data.map((g) => (
              <li key={g.id}>
                <Link href={`/g/${g.id}`}>{g.name}</Link>
                <span className="tag">{ROLE_LABEL[g.myRole]}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="stack">
          <h2>Say you&apos;re in. See your team.</h2>
          <p>
            One place to run your weekly game: who&apos;s playing, who&apos;s on the waitlist, and fair teams. No more
            counting replies in the group chat.
          </p>
          <p className="muted">Got an invite link? Open it from WhatsApp and pick your name.</p>
        </div>
      )}
      <div className="stack">
        <Link className="button primary block" href="/start">
          Start a group
        </Link>
        {!user && (
          <Link className="button quiet block" href="/signin">
            Sign in
          </Link>
        )}
      </div>
    </main>
  );
}
