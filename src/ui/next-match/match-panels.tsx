"use client";

import { useEffect, useState } from "react";
import type { Match } from "../../app-layer";
import type { NextMatchView } from "../../app-layer/views";
import { formatWhen, safeHref, untilLabel } from "../format";

export function MatchLine({ match }: { match: Match }) {
  const mapsHref = safeHref(match.venue?.mapsUrl);
  return (
    <div className="stack">
      <p>
        <strong>{formatWhen(match.startsAt)}</strong>
        {match.venue && (
          <>
            {" at "}
            {mapsHref ? (
              <a href={mapsHref} target="_blank" rel="noopener noreferrer">
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

export function Facts({ match, counts }: { match: Match; counts: NextMatchView["counts"] }) {
  const until = untilLabel(match.startsAt, useNow());
  const { playing, waitlisted, spotsLeft } = counts;
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

export function WhosIn({ people }: { people: NextMatchView["whosIn"] }) {
  const playing = people.filter((p) => p.status === "playing");
  const waiting = people.filter((p) => p.status === "waitlist");
  if (people.length === 0) return <p className="muted">Nobody&apos;s said they&apos;re in yet. Be the first.</p>;
  return (
    <div className="stack">
      <h2>Who&apos;s in</h2>
      <ul className="list" role="list">
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
          <ul className="list" role="list">
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

export function Teams({ view }: { view: NextMatchView }) {
  const teams = view.teams!;
  const draft = teams.state === "draft";
  const side = (label: "A" | "B", people: { membershipId: string; displayName: string }[]) =>
    people.length === 0 ? null : (
      <div key={label}>
        <h3>
          <span className={`bib ${label === "B" ? "b" : ""}`} aria-hidden="true" />
          Team {label}
          {view.myTeam === label && <span className="tag"> (your team)</span>}
        </h3>
        <ul className="list" role="list">
          {people.map((p) => (
            <li key={p.membershipId} className={p.membershipId === view.me.id ? "me" : undefined}>
              <span>{p.displayName}</span>
              {p.membershipId === view.me.id && <span className="tag">You</span>}
            </li>
          ))}
        </ul>
      </div>
    );
  return (
    <div className="stack">
      <h2>{draft ? "Draft teams" : "Teams"}</h2>
      {draft && <p className="muted">Only organisers can see this until it&apos;s published.</p>}
      {!draft && view.me.claim === "pending" && (
        <p className="muted">You can see your own team until an organiser confirms who you are.</p>
      )}
      <div className="teams">
        {side("A", teams.teamA)}
        {side("B", teams.teamB)}
      </div>
    </div>
  );
}
