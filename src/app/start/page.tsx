"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createGroup } from "../../app-layer";
import { ErrorNote, Field, LoadingPage, useTitle } from "../../ui/parts";
import { useSession } from "../../ui/session";
import { useAction } from "../../ui/use-action";

/** Organisers sign in with an email link (no password), then name their game and themselves. */
export default function StartPage() {
  const { client, ready, user, sendMagicLink } = useSession();
  const router = useRouter();
  const action = useAction();
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [groupName, setGroupName] = useState("");
  const [yourName, setYourName] = useState("");
  useTitle("Start a group · Bibleague");

  if (!ready) return <LoadingPage tabs={false} />;

  async function requestLink(e: FormEvent) {
    e.preventDefault();
    const address = email.trim();
    if (await action.run(() => sendMagicLink(address, `${window.location.origin}/start`))) setSentTo(address);
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    await action.run(async () => {
      const groupId = await createGroup(client, { name: groupName, ownerName: yourName });
      router.push(`/g/${groupId}`);
    });
  }

  if (!user || user.isAnonymous) {
    return (
      <main className="page no-tabs">
        <h1>Start a group</h1>
        {sentTo ? (
          <div className="stack" role="status">
            <h2>Check your email</h2>
            <p>
              We sent a sign-in link to <strong>{sentTo}</strong>. Open it on this device to carry on.
            </p>
          </div>
        ) : (
          <form className="stack" onSubmit={requestLink}>
            <p>You run the game, so you sign in. Players just open your invite link.</p>
            <Field label="Your email" hint="We email you a link to sign in. No password.">
              <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <ErrorNote message={action.error} />
            <button className="button primary block" disabled={action.busy}>
              Email me a link
            </button>
          </form>
        )}
      </main>
    );
  }

  return (
    <main className="page no-tabs">
      <h1>Name your game</h1>
      <form className="stack" onSubmit={create}>
        <Field label="Group name">
          <input required maxLength={80} placeholder="Thursday 7pm Powerleague" value={groupName} onChange={(e) => setGroupName(e.target.value)} />
        </Field>
        <Field label="Your name" hint="This is how players will see you.">
          <input required maxLength={80} autoComplete="given-name" value={yourName} onChange={(e) => setYourName(e.target.value)} />
        </Field>
        <ErrorNote message={action.error} />
        <button className="button primary block" disabled={action.busy}>
          Create group
        </button>
      </form>
    </main>
  );
}
