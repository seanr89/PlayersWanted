"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { getInvite, getMyGroups, joinGroup } from "../../../app-layer";
import { ErrorNote, Field, LoadingPage, useTitle } from "../../../ui/parts";
import { useSession } from "../../../ui/session";
import { useAction } from "../../../ui/use-action";
import { useAsync } from "../../../ui/use-async";

/** "Which one are you?": players open the invite link, tap their name, and are in. No password. */
export default function JoinPage() {
  const { token } = useParams<{ token: string }>();
  const { client, ready, ensureSignedIn } = useSession();
  const router = useRouter();
  const action = useAction();
  const [name, setName] = useState("");

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
  useTitle(invite.data ? `Join ${invite.data.groupName}` : "Join a group · Bibleague");

  async function join(args: { name: string; claim?: string }) {
    if (!invite.data) return;
    const groupId = invite.data.groupId;
    const joined = await action.run(async () => {
      await joinGroup(client, token, args);
      router.push(`/g/${groupId}`);
    });
    // If someone else got that name first, show the list as it is now rather than a stale button.
    if (!joined) await invite.reload();
  }

  if (!ready || invite.loading) return <LoadingPage tabs={false} />;
  if (invite.error) {
    return (
      <main className="page no-tabs">
        <h1>This link isn&apos;t working</h1>
        <p>It may have been replaced. Ask the organiser for a new invite link.</p>
      </main>
    );
  }
  if (!invite.data) return <LoadingPage tabs={false} />;

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
              <button key={g.id} className="button block" disabled={action.busy} onClick={() => join({ name: g.displayName, claim: g.id })}>
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
        <Field label="Your name">
          <input required maxLength={80} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <ErrorNote message={action.error} />
        <button className="button primary block" disabled={action.busy || name.trim() === ""}>
          Join
        </button>
      </form>
    </main>
  );
}
