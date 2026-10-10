"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { getMatch } from "../../../app-layer";
import { ErrorNote, Loading } from "../../../ui/parts";
import { useSession } from "../../../ui/session";
import { useAsync } from "../../../ui/use-async";

/** Links in notifications point here; send people to the right Group. */
export default function MatchRedirect() {
  const { matchId } = useParams<{ matchId: string }>();
  const { client, ready } = useSession();
  const router = useRouter();
  const match = useAsync(async () => (ready ? getMatch(client, matchId) : undefined), [client, ready, matchId]);

  useEffect(() => {
    if (match.data) router.replace(`/g/${match.data.groupId}`);
  }, [match.data, router]);

  return (
    <main className="page no-tabs">
      {match.error ? <ErrorNote message="We couldn't open that match. Check you're signed in on this device." /> : <Loading />}
    </main>
  );
}
