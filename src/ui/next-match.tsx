"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import {
  confirmFix,
  dismissFix,
  generateDraftTeams,
  getProposedFix,
  openRsvps,
  publishTeams,
  recordResult,
  setRsvp,
  type FixProposal,
} from "../app-layer";
import { getShareMessage } from "../app-layer/notifications";
import { getNextMatchView, type NextMatchView } from "../app-layer/views";
import { formatWhen, untilLabel } from "./format";
import { ErrorNote, Loading } from "./parts";
import { useSession } from "./session";
import { messageOf, useAsync } from "./use-async";

/** The home screen of a Group: one huge button for players, one clear next step for the organiser. */
export function NextMatch({ groupId }: { groupId: string }) {
  const { client } = useSession();
  const state = useAsync(() => getNextMatchView(client, groupId), [client, groupId], 20_000);

  if (state.loading && !state.data) return <main className="page"><Loading /></main>;
  if (!state.data) return <main className="page"><ErrorNote message={state.error} /></main>;
  const view = state.data;
  const reload = state.reload;

  return (
    <main className="page pitch">
      <header className="stack">
        <h1>{view.groupName}</h1>
        {view.match && <MatchLine view={view} />}
      </header>

      {view.me.claim === "pending" && (
        <p className="note">An organiser needs to confirm you&apos;re {view.me.displayName}. You can still say you&apos;re in.</p>
      )}
      {view.admin && <AdminPanel groupId={groupId} view={view} onChanged={reload} />}

      {view.match ? (
        <>
          <RsvpButton view={view} onChanged={reload} />
          <Facts view={view} />
          {view.teams && <Teams view={view} />}
          <WhosIn view={view} />
        </>
      ) : (
        !view.admin && (
          <div className="stack">
            <h2>No game scheduled yet</h2>
            <p className="muted">When the organiser sets up the next one, it will show up here.</p>
          </div>
        )
      )}
      {state.error && <ErrorNote message={state.error} />}
    </main>
  );
}

function MatchLine({ view }: { view: NextMatchView }) {
  const match = view.match!;
  return (
    <div className="stack">
      <p>
        <strong>{formatWhen(match.startsAt)}</strong>
        {match.venue && (
          <>
            {" at "}
            {match.venue.mapsUrl ? (
              <a href={match.venue.mapsUrl} target="_blank" rel="noopener noreferrer">
                {match.venue.name}
              </a>
            ) : (
              match.venue.name
            )}
          </>
        )}
      </p>
      {match.costPerPlayer > 0 && <p className="muted">Cost: {match.costPerPlayer.toFixed(2)} each.</p>}
    </div>
  );
}

function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function Facts({ view }: { view: NextMatchView }) {
  const now = useNow();
  const match = view.match!;
  const until = untilLabel(match.startsAt, now);
  const { playing, waitlisted, spotsLeft } = view.counts;
  return (
    <div className="facts">
      <p className="big">{playing} in</p>
      <p className="muted">
        {match.status === "scheduled"
          ? "RSVPs aren't open yet."
          : spotsLeft > 0
            ? `${spotsLeft} ${spotsLeft === 1 ? "spot" : "spots"} left.`
            : waitlisted > 0
              ? `Full, with ${waitlisted} on the waitlist.`
              : "Full."}
      </p>
      <p className="muted">{until ? `Kick-off in ${until}.` : "Kick-off has passed."}</p>
    </div>
  );
}

function RsvpButton({ view, onChanged }: { view: NextMatchView; onChanged: () => Promise<void> }) {
  const { client } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const match = view.match!;
  const open = match.status === "rsvps_open" || match.status === "teams_published";
  const { response, status, waitlistPosition } = view.myRsvp;
  const isIn = response === "in";

  async function press() {
    if (isIn && !window.confirm(status === "waitlist" ? "Leave the waitlist?" : "Pull out of this game?")) return;
    setBusy(true);
    setError(null);
    try {
      await setRsvp(client, match.id, isIn ? "out" : "in");
      await onChanged();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  const state = !isIn ? "out" : status === "waitlist" ? "waitlist" : "in";
  return (
    <div className="stack">
      <div className="centre-spot">
        <button className="in-button" data-state={state} disabled={!open || busy} onClick={press}>
          {!open ? (
            <>
              Not open
              <small>RSVPs open soon</small>
            </>
          ) : state === "in" ? (
            <>
              You&apos;re in
              <small>Tap to pull out</small>
            </>
          ) : state === "waitlist" ? (
            <>
              Waitlist {waitlistPosition}
              <small>Tap to leave the queue</small>
            </>
          ) : (
            <>I&apos;m in</>
          )}
        </button>
      </div>
      <ErrorNote message={error} />
    </div>
  );
}

function WhosIn({ view }: { view: NextMatchView }) {
  const playing = view.whosIn.filter((p) => p.status === "playing");
  const waiting = view.whosIn.filter((p) => p.status === "waitlist");
  if (view.whosIn.length === 0) {
    return <p className="muted">Nobody&apos;s said they&apos;re in yet. Be the first.</p>;
  }
  return (
    <div className="stack">
      <h2>Who&apos;s in</h2>
      <ul className="list">
        {playing.map((p) => (
          <li key={p.membershipId}>
            <span>{p.displayName}</span>
            {p.isGuest && <span className="tag">Guest</span>}
          </li>
        ))}
      </ul>
      {waiting.length > 0 && (
        <>
          <h3>Waitlist</h3>
          <ul className="list">
            {waiting.map((p) => (
              <li key={p.membershipId}>
                <span>
                  <span className="place">{p.waitlistPosition}. </span>
                  {p.displayName}
                </span>
                {p.isGuest && <span className="tag">Guest</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Teams({ view }: { view: NextMatchView }) {
  const teams = view.teams!;
  const draft = teams.state === "draft";
  const side = (label: "A" | "B", people: { membershipId: string; displayName: string }[]) =>
    people.length === 0 ? null : (
      <div key={label}>
        <h3>
          <span className={`bib ${label === "B" ? "b" : ""}`} aria-hidden="true" />
          Team {label}
          {view.myTeam === label && <span className="tag"> (you)</span>}
        </h3>
        <ul className="list">
          {people.map((p) => (
            <li key={p.membershipId} className={p.membershipId === view.me.id ? "me" : undefined}>
              {p.displayName}
            </li>
          ))}
        </ul>
      </div>
    );
  return (
    <div className="stack">
      <h2>{draft ? "Draft teams" : "Teams"}</h2>
      {draft && <p className="muted">Only organisers can see this until it&apos;s published.</p>}
      <div className="teams">
        {side("A", teams.teamA)}
        {side("B", teams.teamB)}
      </div>
    </div>
  );
}

/* ---- Organiser: the one clear next step ---------------------------------------------------- */

function AdminPanel({ groupId, view, onChanged }: { groupId: string; view: NextMatchView; onChanged: () => Promise<void> }) {
  const { client } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const admin = view.admin!;
  const match = view.match;

  async function run(task: () => Promise<void>) {
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

  const share = (kind: "rsvps_open" | "match_at_risk" | "teams_published") =>
    run(async () => {
      const message = await getShareMessage(client, match!.id, kind);
      window.open(message.whatsappUrl, "_blank", "noopener,noreferrer");
    });

  let body: ReactNode;
  switch (admin.nextAction) {
    case "create_match":
      body = (
        <>
          <p>No game scheduled.</p>
          <Link className="button primary" href={`/g/${groupId}/matches`}>
            Create a match
          </Link>
        </>
      );
      break;
    case "open_rsvps":
      body = (
        <>
          <p>RSVPs aren&apos;t open yet.</p>
          <button className="button primary" disabled={busy} onClick={() => run(() => openRsvps(client, match!.id))}>
            Open RSVPs
          </button>
        </>
      );
      break;
    case "nudge":
      body = (
        <>
          <p>
            {admin.inCount} in, and you need {view.minPlayers} to play.
          </p>
          <button className="button primary" disabled={busy} onClick={() => share("match_at_risk")}>
            Nudge the group on WhatsApp
          </button>
        </>
      );
      break;
    case "generate_teams":
      body = (
        <>
          <p>{admin.inCount} in. Ready to pick teams.</p>
          <button className="button primary" disabled={busy} onClick={() => run(() => generateDraftTeams(client, match!.id))}>
            Make teams
          </button>
        </>
      );
      break;
    case "publish_teams":
      body = (
        <>
          <p>Teams are drafted. Players can&apos;t see them yet.</p>
          <div className="row wrap">
            <button className="button primary" disabled={busy} onClick={() => run(() => publishTeams(client, match!.id))}>
              Publish teams
            </button>
            <button className="button quiet" disabled={busy} onClick={() => run(() => generateDraftTeams(client, match!.id))}>
              Make them again
            </button>
          </div>
        </>
      );
      break;
    case "review_dropout":
      body = <ReviewDropout matchId={match!.id} onChanged={onChanged} />;
      break;
    case "record_result":
      body = <RecordResult matchId={match!.id} onChanged={onChanged} />;
      break;
    default:
      body = (
        <>
          <p>All sorted. Teams are published.</p>
          <button className="button quiet" disabled={busy} onClick={() => share("teams_published")}>
            Share teams on WhatsApp
          </button>
        </>
      );
  }

  return (
    <section className="admin-strip" aria-label="Organiser">
      {body}
      {match && match.status === "rsvps_open" && admin.nextAction !== "nudge" && (
        <button className="button quiet" disabled={busy} onClick={() => share("rsvps_open")}>
          Share the invite on WhatsApp
        </button>
      )}
      {admin.pendingClaims > 0 && (
        <p>
          <Link href={`/g/${groupId}/squad`}>
            {admin.pendingClaims} {admin.pendingClaims === 1 ? "person is" : "people are"} waiting to be confirmed.
          </Link>
        </p>
      )}
      <ErrorNote message={error} />
    </section>
  );
}

function ReviewDropout({ matchId, onChanged }: { matchId: string; onChanged: () => Promise<void> }) {
  const { client } = useSession();
  const fix = useAsync(() => getProposedFix(client, matchId), [client, matchId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(task: (f: FixProposal) => Promise<void>) {
    if (!fix.data) return;
    setBusy(true);
    setError(null);
    try {
      await task(fix.data);
      await onChanged();
    } catch (e) {
      setError(messageOf(e));
      setBusy(false);
    }
  }

  if (fix.loading) return <Loading />;
  if (!fix.data) return <p>Nothing to fix.</p>;
  const names = (people: { displayName: string }[]) => people.map((p) => p.displayName).join(", ");
  return (
    <>
      <p>
        <strong>{names(fix.data.vacated)}</strong> dropped out.{" "}
        {fix.data.promoted.length > 0 && <>{names(fix.data.promoted)} comes off the waitlist. </>}
        {fix.data.moved.length > 0 && <>{names(fix.data.moved)} would switch teams to even it up. </>}
        The teams stay as published until you confirm.
      </p>
      <div className="row wrap">
        <button className="button primary" disabled={busy} onClick={() => run((f) => confirmFix(client, matchId, f))}>
          Confirm the fix
        </button>
        <button className="button quiet" disabled={busy} onClick={() => run((f) => dismissFix(client, matchId, f))}>
          Leave the teams as they are
        </button>
      </div>
      <ErrorNote message={error} />
    </>
  );
}

function RecordResult({ matchId, onChanged }: { matchId: string; onChanged: () => Promise<void> }) {
  const { client } = useSession();
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await recordResult(client, matchId, { scoreA: Number(a), scoreB: Number(b) });
      await onChanged();
    } catch (e) {
      setError(messageOf(e));
      setBusy(false);
    }
  }

  return (
    <>
      <p>The game&apos;s started. Record the score when it&apos;s over.</p>
      <div className="score-row">
        <label>
          Team A
          <input inputMode="numeric" type="number" min={0} value={a} onChange={(e) => setA(e.target.value)} />
        </label>
        <span className="dash">–</span>
        <label>
          Team B
          <input inputMode="numeric" type="number" min={0} value={b} onChange={(e) => setB(e.target.value)} />
        </label>
      </div>
      <button className="button primary" disabled={busy || a === "" || b === ""} onClick={save}>
        Save the score
      </button>
      <ErrorNote message={error} />
    </>
  );
}
