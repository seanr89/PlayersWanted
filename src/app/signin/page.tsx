"use client";

import { useState, type FormEvent } from "react";
import { ErrorNote, Field, LoadingPage, useTitle } from "../../ui/parts";
import { useSession } from "../../ui/session";
import { useAction } from "../../ui/use-action";

/** Coming back on a new phone: organisers, and players who saved their place with an email. */
export default function SignInPage() {
  const { ready, sendMagicLink } = useSession();
  const action = useAction();
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  useTitle("Sign in · Bibleague");

  if (!ready) return <LoadingPage tabs={false} />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const address = email.trim();
    if (await action.run(() => sendMagicLink(address, `${window.location.origin}/`))) setSentTo(address);
  }

  return (
    <main className="page no-tabs">
      <h1>Sign in</h1>
      {sentTo ? (
        <div className="stack" role="status">
          <h2>Check your email</h2>
          <p>
            We sent a sign-in link to <strong>{sentTo}</strong>. Open it on this device.
          </p>
        </div>
      ) : (
        <form className="stack" onSubmit={submit}>
          <Field label="Your email" hint="We email you a link. No password.">
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
