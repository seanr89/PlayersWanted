"use client";

import { useParams } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { addGhost, confirmClaim, getSquad, rejectClaim, type SquadMember } from "../../../../app-layer";
import { getMyMembership, isAdminRole } from "../../../../app-layer/views";
import { POSITION_LABEL } from "../../../../ui/format";
import { ErrorNote, Field, LoadingPage, useTitle } from "../../../../ui/parts";
import { useSession } from "../../../../ui/session";
import { HappyInGoalToggle, PlayerEditor } from "../../../../ui/squad/edit-player";
import { useAction } from "../../../../ui/use-action";
import { useAsync } from "../../../../ui/use-async";

export default function SquadPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const [editing, setEditing] = useState<string | null>(null);
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  const { client } = useSession();
  const data = useAsync(async () => {
    const [me, squad] = await Promise.all([getMyMembership(client, groupId), getSquad(client, groupId)]);
    return { squad, admin: isAdminRole(me?.role), myId: me?.id ?? null };
  }, [client, groupId]);
  useTitle("Squad · Bibleague");

  if (data.loading && !data.data) return <LoadingPage />;
  if (!data.data) {
    return (
      <main className="page">
        <h1>Squad</h1>
        <ErrorNote message={data.error} />
      </main>
    );
  }
  const { squad, admin, myId } = data.data;
  const pending = squad.filter((m) => m.claim === "pending");

  return (
    <main className="page">
      <h1>Squad</h1>
      {admin && pending.length > 0 && <PendingClaims people={pending} onChanged={data.reload} />}
      <ul className="list" role="list">
        {squad.map((m) => (
          <li key={m.id} className={admin || m.id === myId ? "editable" : undefined}>
            <span>{m.displayName}</span>
            <span className="tag">{describe(m, admin)}</span>
            {admin && editing !== m.id && (
              <button
                className="button quiet"
                aria-label={`Edit ${m.displayName}`}
                ref={(el) => {
                  if (el) editButtons.current.set(m.id, el);
                  else editButtons.current.delete(m.id);
                }}
                onClick={() => setEditing(m.id)}
              >
                Edit
              </button>
            )}
            {admin && editing === m.id && (
              <PlayerEditor
                member={m}
                onSaved={data.reload}
                onClose={() => {
                  setEditing(null);
                  // The Edit button is remounted, so hand focus back once it exists.
                  requestAnimationFrame(() => editButtons.current.get(m.id)?.focus());
                }}
              />
            )}
            {!admin && m.id === myId && <HappyInGoalToggle member={m} onSaved={data.reload} />}
          </li>
        ))}
      </ul>
      {admin && <AddPlayer groupId={groupId} onAdded={data.reload} />}
    </main>
  );
}

function describe(m: SquadMember, admin: boolean): string {
  const bits: string[] = [];
  if (m.role === "owner") bits.push("Owner");
  else if (m.role === "admin") bits.push("Admin");
  if (m.claim === "ghost") bits.push("Hasn't joined yet");
  if (m.claim === "pending") bits.push("Waiting to be confirmed");
  if (m.position) bits.push(POSITION_LABEL[m.position]);
  if (m.happyInGoal) bits.push("Happy in goal");
  if (admin && m.rating !== undefined) bits.push(`Rating ${m.rating}`);
  return bits.join(", ");
}

function PendingClaims({ people, onChanged }: { people: SquadMember[]; onChanged: () => Promise<void> }) {
  const { client } = useSession();
  const action = useAction();
  const decide = (task: () => Promise<unknown>) =>
    action.run(async () => {
      await task();
      await onChanged();
    });

  return (
    <section className="admin-strip" aria-label="Claims to confirm">
      <h2>Is this who they say they are?</h2>
      {people.map((p) => (
        <div key={p.id} className="row spread wrap">
          <span>Someone says they&apos;re {p.displayName}.</span>
          <span className="row">
            <button className="button primary" disabled={action.busy} onClick={() => decide(() => confirmClaim(client, p.id))}>
              That&apos;s them
            </button>
            <button className="button quiet" disabled={action.busy} onClick={() => decide(() => rejectClaim(client, p.id))}>
              Not them
            </button>
          </span>
        </div>
      ))}
      <ErrorNote message={action.error} />
    </section>
  );
}

function AddPlayer({ groupId, onAdded }: { groupId: string; onAdded: () => Promise<void> }) {
  const { client } = useSession();
  const action = useAction();
  const [name, setName] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    const added = await action.run(async () => {
      await addGhost(client, groupId, name);
      await onAdded();
    });
    if (added) setName("");
  }

  return (
    <form className="stack" onSubmit={submit}>
      <h2>Add a player</h2>
      <p className="muted">Add them by name now. They can pick it from the list when they open your invite link.</p>
      <Field label="Name">
        <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <ErrorNote message={action.error} />
      <button className="button primary" disabled={action.busy || name.trim() === ""}>
        Add player
      </button>
    </form>
  );
}
