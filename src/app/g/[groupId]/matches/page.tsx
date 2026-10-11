"use client";

import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { cancelMatch, createMatch, getMatches, getResult, type Match, type MatchResult } from "../../../../app-layer";
import { getMyMembership, isAdminRole } from "../../../../app-layer/views";
import { MATCH_STATUS_LABEL, formatWhen } from "../../../../ui/format";
import { Confirm, ErrorNote, Field, LoadingPage, useTitle } from "../../../../ui/parts";
import { useSession } from "../../../../ui/session";
import { useAction } from "../../../../ui/use-action";
import { useAsync } from "../../../../ui/use-async";

interface Row {
  match: Match;
  result: MatchResult | null;
}

const UPCOMING = ["scheduled", "rsvps_open", "teams_published"];

export default function MatchesPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const { client } = useSession();
  const data = useAsync(async () => {
    const [me, matches] = await Promise.all([getMyMembership(client, groupId), getMatches(client, groupId)]);
    const rows: Row[] = await Promise.all(
      matches.map(async (match) => ({ match, result: match.status === "played" ? await getResult(client, match.id) : null })),
    );
    return { admin: isAdminRole(me?.role), rows };
  }, [client, groupId]);
  useTitle("Matches · Bibleague");

  if (data.loading && !data.data) return <LoadingPage />;
  if (!data.data) {
    return (
      <main className="page">
        <h1>Matches</h1>
        <ErrorNote message={data.error} />
      </main>
    );
  }

  const { admin, rows } = data.data;
  const upcoming = rows.filter((r) => UPCOMING.includes(r.match.status)).sort((a, b) => a.match.startsAt.localeCompare(b.match.startsAt));
  const past = rows.filter((r) => !UPCOMING.includes(r.match.status)).sort((a, b) => b.match.startsAt.localeCompare(a.match.startsAt));

  return (
    <main className="page">
      <h1>Matches</h1>
      {admin && <NewMatch groupId={groupId} onCreated={data.reload} />}
      <div className="stack">
        <h2>Coming up</h2>
        {upcoming.length === 0 ? (
          <p className="muted">Nothing scheduled.</p>
        ) : (
          <ul className="list" role="list">
            {upcoming.map(({ match }) => (
              <UpcomingRow key={match.id} match={match} admin={admin} onChanged={data.reload} />
            ))}
          </ul>
        )}
      </div>
      {past.length > 0 && (
        <div className="stack">
          <h2>Past</h2>
          <ul className="list" role="list">
            {past.map(({ match, result }) => (
              <li key={match.id}>
                <span>{formatWhen(match.startsAt)}</span>
                <span className="tag">
                  {match.status === "played" && result ? `Team A ${result.scoreA}–${result.scoreB} Team B` : MATCH_STATUS_LABEL[match.status]}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}

function UpcomingRow({ match, admin, onChanged }: { match: Match; admin: boolean; onChanged: () => Promise<void> }) {
  const { client } = useSession();
  const action = useAction();
  const [confirming, setConfirming] = useState(false);

  return (
    <li style={{ flexWrap: "wrap" }}>
      <span>
        {formatWhen(match.startsAt)}
        {match.venue && <span className="tag"> at {match.venue.name}</span>}
      </span>
      <span className="row">
        <span className="tag">{MATCH_STATUS_LABEL[match.status]}</span>
        {admin && !confirming && (
          <button className="button quiet" onClick={() => setConfirming(true)}>
            Cancel match
          </button>
        )}
      </span>
      {confirming && (
        <div style={{ flexBasis: "100%" }}>
          <Confirm
            question="Cancel this match? Everyone who was told about it will hear it's off."
            yes="Cancel the match"
            no="Keep it"
            busy={action.busy}
            onYes={async () => {
              if (await action.run(async () => (await cancelMatch(client, match.id), await onChanged()))) setConfirming(false);
            }}
            onNo={() => setConfirming(false)}
          />
          <ErrorNote message={action.error} />
        </div>
      )}
    </li>
  );
}

function NewMatch({ groupId, onCreated }: { groupId: string; onCreated: () => Promise<void> }) {
  const { client } = useSession();
  const action = useAction();
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState("");
  const [capacity, setCapacity] = useState("10");
  const [cost, setCost] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    const created = await action.run(async () => {
      await createMatch(client, groupId, {
        startsAt: new Date(when),
        capacity: Number(capacity),
        ...(cost === "" ? {} : { costPerPlayer: Number(cost) }),
      });
      await onCreated();
    });
    if (created) {
      setOpen(false);
      setWhen("");
      setCost("");
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
      <Field label="Kick-off">
        <input type="datetime-local" required value={when} onChange={(e) => setWhen(e.target.value)} />
      </Field>
      <Field label="Players" hint="Once this many say they're in, the rest go on the waitlist.">
        <input type="number" inputMode="numeric" min={2} required value={capacity} onChange={(e) => setCapacity(e.target.value)} />
      </Field>
      <Field label="Cost each" hint="Shown to players. Nobody pays through the app.">
        <input type="number" inputMode="decimal" min={0} step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} />
      </Field>
      <ErrorNote message={action.error} />
      <div className="row">
        <button className="button primary" disabled={action.busy}>
          Create match
        </button>
        <button type="button" className="button quiet" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
