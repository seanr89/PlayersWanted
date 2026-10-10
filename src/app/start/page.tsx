"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createGroup } from "../../app-layer";
import { ErrorNote, Loading } from "../../ui/parts";
import { useSession } from "../../ui/session";
import { messageOf } from "../../ui/use-async";

/** Organisers sign in with an email link (no password), then name their game and themselves. */
export default function StartPage() {
  const { client, ready, user, sendMagicLink } = useSession();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [groupName, setGroupName] = useState("");
  const [yourName, setYourName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!ready) return <main className="page no-tabs"><Loading /></main>;

  async function requestLink(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await sendMagicLink(email.trim(), `${window.location.origin}/start`);
      setSentTo(email.trim());
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const groupId = await createGroup(client, { name: groupName, ownerName: yourName });
      router.push(`/g/${groupId}`);
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  }

  if (!user || user.isAnonymous) {
    return (
      <main className="page no-tabs">
        <h1>Start a group</h1>
        {sentTo ? (
          <div className="stack">
            <h2>Check your email</h2>
            <p>
              We sent a sign-in link to <strong>{sentTo}</strong>. Open it on this device to carry on.
            </p>
          </div>
        ) : (
          <form className="stack" onSubmit={requestLink}>
            <p>You run the game, so you sign in. Players just open your invite link.</p>
            <label>
              Your email
              <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              <span className="field-hint">We email you a link to sign in. No password.</span>
            </label>
            <ErrorNote message={error} />
            <button className="button primary block" disabled={busy}>
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
        <label>
          Group name
          <input required maxLength={80} placeholder="Thursday 7pm Powerleague" value={groupName} onChange={(e) => setGroupName(e.target.value)} />
        </label>
        <label>
          Your name
          <input required maxLength={80} autoComplete="given-name" value={yourName} onChange={(e) => setYourName(e.target.value)} />
          <span className="field-hint">This is how players will see you.</span>
        </label>
        <ErrorNote message={error} />
        <button className="button primary block" disabled={busy}>
          Create group
        </button>
      </form>
    </main>
  );
}
