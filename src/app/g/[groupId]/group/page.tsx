"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { getGroup, getInviteToken, leaveGroup } from "../../../../app-layer";
import { getMyMembership } from "../../../../app-layer/views";
import { ErrorNote, Loading } from "../../../../ui/parts";
import { useSession } from "../../../../ui/session";
import { messageOf, useAsync } from "../../../../ui/use-async";

export default function GroupPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const { client, user, signOut } = useSession();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const data = useAsync(async () => {
    const [group, me] = await Promise.all([getGroup(client, groupId), getMyMembership(client, groupId)]);
    const admin = me?.role === "owner" || me?.role === "admin";
    const token = admin ? await getInviteToken(client, groupId) : null;
    return { group, me, admin, token };
  }, [client, groupId]);

  if (data.loading && !data.data) return <main className="page"><Loading /></main>;
  if (!data.data) return <main className="page"><ErrorNote message={data.error} /></main>;
  const { group, me, admin, token } = data.data;

  async function leave() {
    if (!window.confirm("Leave this group? Your name will be removed, but your past games stay in the record.")) return;
    try {
      await leaveGroup(client, groupId);
      router.replace("/");
    } catch (e) {
      setError(messageOf(e));
    }
  }

  return (
    <main className="page">
      <h1>{group.name}</h1>

      <div className="stack">
        <h2>You</h2>
        <p>
          You&apos;re <strong>{me?.displayName}</strong>
          {group.myRole === "owner" ? ", the owner." : group.myRole === "admin" ? ", an admin." : "."}
        </p>
      </div>

      {admin && token && <Invite groupName={group.name} token={token} />}

      {admin && (
        <div className="stack">
          <h2>How it works</h2>
          <p className="muted">
            The game needs {group.minPlayers} players. {group.showTeamStrength ? "Players can see how evenly matched the teams are." : "Players only see their own team."}
          </p>
        </div>
      )}

      <div className="stack">
        {group.myRole !== "owner" && (
          <button className="button quiet block" onClick={leave}>
            Leave this group
          </button>
        )}
        {user && !user.isAnonymous && (
          <button
            className="button quiet block"
            onClick={async () => {
              await signOut();
              router.replace("/");
            }}
          >
            Sign out
          </button>
        )}
        <ErrorNote message={error} />
      </div>
    </main>
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
      window.prompt("Copy this invite link", link);
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
