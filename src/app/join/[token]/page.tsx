"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { getInvite, getMyGroups, joinGroup } from "../../../app-layer";
import { ErrorNote, Loading } from "../../../ui/parts";
import { useSession } from "../../../ui/session";
import { messageOf, useAsync } from "../../../ui/use-async";

/** "Which one are you?": players open the invite link, tap their name, and are in. No password. */
export default function JoinPage() {
  const { token } = useParams<{ token: string }>();
  const { client, ready, ensureSignedIn } = useSession();
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const invite = useAsync(async () => {
    if (!ready) return null;
    await ensureSignedIn();
    const found = await getInvite(client, token);
    const mine = await getMyGroups(client);
    if (mine.some((g) => g.id === found.groupId)) {
      router.replace(`/g/${found.groupId}`);
      return null;
    }
    return found;
  }, [client, ready, token]);

  async function join(args: { name: string; claim?: string }) {
    if (!invite.data) return;
    setBusy(true);
    setError(null);
    try {
      await joinGroup(client, token, args);
      router.push(`/g/${invite.data.groupId}`);
    } catch (e) {
      setError(messageOf(e));
      setBusy(false);
    }
  }

  if (!ready || invite.loading) return <main className="page no-tabs"><Loading /></main>;
  if (invite.error) {
    return (
      <main className="page no-tabs">
        <h1>This link isn&apos;t working</h1>
        <p>It may have been replaced. Ask the organiser for a new invite link.</p>
      </main>
    );
  }
  if (!invite.data) return <main className="page no-tabs"><Loading /></main>;

  const { groupName, ghosts } = invite.data;
  return (
    <main className="page no-tabs pitch">
      <div className="stack">
        <p className="muted">You&apos;ve been invited to</p>
        <h1>{groupName}</h1>
      </div>
      {ghosts.length > 0 && (
        <div className="stack">
          <h2>Which one are you?</h2>
          <div className="pick-list">
            {ghosts.map((g) => (
              <button key={g.id} className="button block" disabled={busy} onClick={() => join({ name: g.displayName, claim: g.id })}>
                I&apos;m {g.displayName}
              </button>
            ))}
          </div>
        </div>
      )}
      <form
        className="stack"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void join({ name: name.trim() });
        }}
      >
        <h2>{ghosts.length > 0 ? "Not on the list?" : "What should we call you?"}</h2>
        <label>
          Your name
          <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <ErrorNote message={error} />
        <button className="button primary block" disabled={busy || name.trim() === ""}>
          Join
        </button>
      </form>
    </main>
  );
}
