"use client";

import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { addGhost, confirmClaim, getSquad, rejectClaim, type SquadMember } from "../../../../app-layer";
import { getMyMembership } from "../../../../app-layer/views";
import { ErrorNote, Loading } from "../../../../ui/parts";
import { useSession } from "../../../../ui/session";
import { messageOf, useAsync } from "../../../../ui/use-async";

export default function SquadPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const { client } = useSession();
  const data = useAsync(async () => {
    const [me, squad] = await Promise.all([getMyMembership(client, groupId), getSquad(client, groupId)]);
    return { me, squad, admin: me?.role === "owner" || me?.role === "admin" };
  }, [client, groupId]);

  if (data.loading && !data.data) return <main className="page"><Loading /></main>;
  if (!data.data) return <main className="page"><ErrorNote message={data.error} /></main>;
  const { squad, admin } = data.data;
  const pending = squad.filter((m) => m.claim === "pending");

  return (
    <main className="page">
      <h1>Squad</h1>
      {admin && pending.length > 0 && <PendingClaims people={pending} onChanged={data.reload} />}
      <ul className="list">
        {squad.map((m) => (
          <li key={m.id}>
            <span>{m.displayName}</span>
            <span className="tag">{describe(m, admin)}</span>
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
  if (m.position) bits.push(m.position === "GK" ? "Goalkeeper" : m.position === "defender" ? "Defender" : "Attacker");
  if (m.happyInGoal) bits.push("Happy in goal");
  if (admin && m.rating !== undefined) bits.push(`Rating ${m.rating}`);
  return bits.join(", ");
}

function PendingClaims({ people, onChanged }: { people: SquadMember[]; onChanged: () => Promise<void> }) {
  const { client } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function decide(task: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await task();
      await onChanged();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-strip" aria-label="Claims to confirm">
      <h2>Is this who they say they are?</h2>
      {people.map((p) => (
        <div key={p.id} className="row spread wrap">
          <span>Someone says they&apos;re {p.displayName}.</span>
          <span className="row">
            <button className="button primary" disabled={busy} onClick={() => decide(() => confirmClaim(client, p.id))}>
              That&apos;s them
            </button>
            <button className="button quiet" disabled={busy} onClick={() => decide(() => rejectClaim(client, p.id))}>
              Not them
            </button>
          </span>
        </div>
      ))}
      <ErrorNote message={error} />
    </section>
  );
}

function AddPlayer({ groupId, onAdded }: { groupId: string; onAdded: () => Promise<void> }) {
  const { client } = useSession();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await addGhost(client, groupId, name);
      setName("");
      await onAdded();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <h2>Add a player</h2>
      <p className="muted">Add them by name now. They can pick it from the list when they open your invite link.</p>
      <label>
        Name
        <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <ErrorNote message={error} />
      <button className="button primary" disabled={busy || name.trim() === ""}>
        Add player
      </button>
    </form>
  );
}
