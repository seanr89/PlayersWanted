"use client";

import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createMatch, getMatches, getResult, type Match, type MatchResult } from "../../../../app-layer";
import { getMyMembership } from "../../../../app-layer/views";
import { formatWhen } from "../../../../ui/format";
import { ErrorNote, Loading } from "../../../../ui/parts";
import { useSession } from "../../../../ui/session";
import { messageOf, useAsync } from "../../../../ui/use-async";

interface Row {
  match: Match;
  result: MatchResult | null;
}

export default function MatchesPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const { client } = useSession();
  const data = useAsync(async () => {
    const [me, matches] = await Promise.all([getMyMembership(client, groupId), getMatches(client, groupId)]);
    const rows: Row[] = await Promise.all(
      matches.map(async (match) => ({ match, result: match.status === "played" ? await getResult(client, match.id) : null })),
    );
    return { admin: me?.role === "owner" || me?.role === "admin", rows };
  }, [client, groupId]);

  if (data.loading && !data.data) return <main className="page"><Loading /></main>;
  if (!data.data) return <main className="page"><ErrorNote message={data.error} /></main>;

  const upcoming = data.data.rows
    .filter((r) => ["scheduled", "rsvps_open", "teams_published"].includes(r.match.status))
    .sort((a, b) => a.match.startsAt.localeCompare(b.match.startsAt));
  const past = data.data.rows
    .filter((r) => ["played", "cancelled"].includes(r.match.status))
    .sort((a, b) => b.match.startsAt.localeCompare(a.match.startsAt));

  return (
    <main className="page">
      <h1>Matches</h1>
      {data.data.admin && <NewMatch groupId={groupId} onCreated={data.reload} />}
      <div className="stack">
        <h2>Coming up</h2>
        {upcoming.length === 0 ? (
          <p className="muted">Nothing scheduled.</p>
        ) : (
          <ul className="list">
            {upcoming.map(({ match }) => (
              <li key={match.id}>
                <span>
                  {formatWhen(match.startsAt)}
                  {match.venue && <span className="tag"> at {match.venue.name}</span>}
                </span>
                <span className="tag">{statusLabel(match.status)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {past.length > 0 && (
        <div className="stack">
          <h2>Past</h2>
          <ul className="list">
            {past.map(({ match, result }) => (
              <li key={match.id}>
                <span>{formatWhen(match.startsAt)}</span>
                <span className="tag">
                  {match.status === "cancelled" ? "Cancelled" : result ? `Team A ${result.scoreA}–${result.scoreB} Team B` : "Played"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}

const statusLabel = (status: Match["status"]) =>
  status === "scheduled" ? "RSVPs not open" : status === "rsvps_open" ? "RSVPs open" : status === "teams_published" ? "Teams out" : status;

function NewMatch({ groupId, onCreated }: { groupId: string; onCreated: () => Promise<void> }) {
  const { client } = useSession();
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState("");
  const [capacity, setCapacity] = useState("10");
  const [cost, setCost] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createMatch(client, groupId, {
        startsAt: new Date(when),
        capacity: Number(capacity),
        ...(cost === "" ? {} : { costPerPlayer: Number(cost) }),
      });
      setOpen(false);
      setWhen("");
      setCost("");
      await onCreated();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="button primary block" onClick={() => setOpen(true)}>
        New match
      </button>
    );
  }
  return (
    <form className="stack" onSubmit={submit}>
      <h2>New match</h2>
      <label>
        Kick-off
        <input type="datetime-local" required value={when} onChange={(e) => setWhen(e.target.value)} />
      </label>
      <label>
        Players
        <input type="number" inputMode="numeric" min={2} required value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        <span className="field-hint">Once this many say they&apos;re in, the rest go on the waitlist.</span>
      </label>
      <label>
        Cost each
        <input type="number" inputMode="decimal" min={0} step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} />
        <span className="field-hint">Shown to players. Nobody pays through the app.</span>
      </label>
      <ErrorNote message={error} />
      <div className="row">
        <button className="button primary" disabled={busy}>
          Create match
        </button>
        <button type="button" className="button quiet" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
