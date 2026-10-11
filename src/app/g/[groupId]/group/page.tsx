"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { getGroup, getInviteToken, leaveGroup } from "../../../../app-layer";
import { getMyMembership, isAdminRole } from "../../../../app-layer/views";
import { ROLE_LABEL } from "../../../../ui/format";
import { Confirm, ErrorNote, Field, LoadingPage, useTitle } from "../../../../ui/parts";
import { useSession } from "../../../../ui/session";
import { useAction } from "../../../../ui/use-action";
import { useAsync } from "../../../../ui/use-async";

export default function GroupPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const { client, user, signOut } = useSession();
  const router = useRouter();
  const action = useAction();
  const [leaving, setLeaving] = useState(false);
  const [saved, setSaved] = useState<{ email: string; needsConfirmation: boolean } | null>(null);
  const data = useAsync(async () => {
    const [group, me] = await Promise.all([getGroup(client, groupId), getMyMembership(client, groupId)]);
    const admin = isAdminRole(me?.role);
    const token = admin ? await getInviteToken(client, groupId) : null;
    return { group, me, admin, token };
  }, [client, groupId]);
  useTitle(data.data ? `Group · ${data.data.group.name}` : undefined);

  if (data.loading && !data.data) return <LoadingPage />;
  if (!data.data) {
    return (
      <main className="page">
        <h1>Group</h1>
        <ErrorNote message={data.error} />
      </main>
    );
  }
  const { group, me, admin, token } = data.data;

  return (
    <main className="page">
      <h1>{group.name}</h1>

      <div className="stack">
        <h2>You</h2>
        <p>
          You&apos;re <strong>{me?.displayName}</strong>
          {group.myRole === "member" ? "." : `, ${group.myRole === "owner" ? "the owner" : "an admin"}.`}
        </p>
        <p className="muted">Your role: {ROLE_LABEL[group.myRole]}.</p>
      </div>

      {(user?.isAnonymous || saved) && <KeepYourPlace saved={saved} onSaved={setSaved} />}
      {admin && token && <Invite groupName={group.name} token={token} />}

      {admin && (
        <div className="stack">
          <h2>How it works</h2>
          <p className="muted">
            The game needs {group.minPlayers} players.{" "}
            {group.showTeamStrength ? "Players can see how evenly matched the teams are." : "Players only see their own team."}
          </p>
        </div>
      )}

      <div className="stack">
        {group.myRole !== "owner" && !leaving && (
          <button className="button quiet block" onClick={() => setLeaving(true)}>
            Leave this group
          </button>
        )}
        {leaving && (
          <Confirm
            question="Leave this group? Your name is removed, but the games you played stay in the record without it."
            yes="Leave the group"
            no="Stay"
            busy={action.busy}
            onYes={() =>
              action.run(async () => {
                await leaveGroup(client, groupId);
                router.replace("/");
              })
            }
            onNo={() => setLeaving(false)}
          />
        )}
        {user && !user.isAnonymous && (
          <button
            className="button quiet block"
            onClick={() =>
              action.run(async () => {
                await signOut();
                router.replace("/");
              })
            }
          >
            Sign out
          </button>
        )}
        <ErrorNote message={action.error} />
      </div>
    </main>
  );
}

/** Players join with no account. Adding an email means they can get back in if they change phone or clear their browser. */
function KeepYourPlace({
  saved,
  onSaved,
}: {
  saved: { email: string; needsConfirmation: boolean } | null;
  onSaved: (saved: { email: string; needsConfirmation: boolean }) => void;
}) {
  const { linkEmail } = useSession();
  const action = useAction();
  const [email, setEmail] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    const address = email.trim();
    await action.run(async () => onSaved({ email: address, ...(await linkEmail(address, `${window.location.origin}/`)) }));
  }

  return (
    <div className="stack">
      <h2>Keep your place</h2>
      {saved ? (
        <p role="status">
          {saved.needsConfirmation ? (
            <>
              We sent a link to <strong>{saved.email}</strong>. Open it to finish.
            </>
          ) : (
            <>
              Saved. You can sign in with <strong>{saved.email}</strong> on any phone.
            </>
          )}
        </p>
      ) : (
        <form className="stack" onSubmit={submit}>
          <p className="muted">
            You joined without an account. Add your email so you can get back in if you change phone or clear your browser.
          </p>
          <Field label="Your email">
            <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <ErrorNote message={action.error} />
          <button className="button block" disabled={action.busy}>
            Save my place
          </button>
        </form>
      )}
    </div>
  );
}

function Invite({ groupName, token }: { groupName: string; token: string }) {
  const [copied, setCopied] = useState(false);
  const link = typeof window === "undefined" ? "" : `${window.location.origin}/join/${token}`;
  const text = `Join ${groupName} on Bibleague: ${link}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false); // the link is on screen to copy by hand
    }
  }

  return (
    <div className="stack">
      <h2>Invite players</h2>
      <p className="muted">Post this link in your group chat. Anyone with it can join.</p>
      <p style={{ overflowWrap: "anywhere" }}>{link}</p>
      <div className="row wrap">
        <a className="button primary" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">
          Share on WhatsApp
        </a>
        <button className="button" onClick={copy}>
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
    </div>
  );
}
