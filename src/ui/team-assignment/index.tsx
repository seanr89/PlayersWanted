"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { generateDraftTeams, publishTeams, reshuffleDraftTeams, swapPlayers } from "../../app-layer";
import { getTeamAssignmentView, type AssignedPlayer, type TeamAssignmentView } from "../../app-layer/views";
import type { Violation } from "../../team-generator";
import { POSITION_LABEL, formatWhen } from "../format";
import { Confirm, ErrorNote, LoadingPage, useTitle } from "../parts";
import { useSession } from "../session";
import { useAction } from "../use-action";
import { useAsync } from "../use-async";
import { TONE_LABEL, scoreArrangement, swap, type Arrangement, type Score } from "./balance";

/**
 * Pick and tweak the teams. Tap a player, then a player on the other team, to swap them. The Balance meter updates
 * on the spot (scored on the device by the generator's own scoring); the swap is saved in the background and rolled
 * back if saving fails. Teams stay a private draft until published.
 */
export function TeamAssignment({ groupId, matchId }: { groupId: string; matchId: string }) {
  const { client } = useSession();
  const router = useRouter();
  const view = useAsync(() => getTeamAssignmentView(client, matchId), [client, matchId]);
  const action = useAction();
  const [local, setLocal] = useState<Arrangement | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [startingAgain, setStartingAgain] = useState(false);
  useTitle("Teams · Bibleague");

  // Whatever the server says is the truth: drop the optimistic arrangement when fresh data arrives.
  useEffect(() => setLocal(null), [view.data]);

  const data = view.data;
  const byId = useMemo(() => new Map(data ? [...data.teamA, ...data.teamB].map((p) => [p.membershipId, p]) : []), [data]);

  if (view.loading && !data) return <LoadingPage />;
  if (!data) {
    return (
      <main className="page">
        <h1>Teams</h1>
        <ErrorNote message={view.error} />
        <Link className="button block" href={`/g/${groupId}`}>
          Back to the next match
        </Link>
      </main>
    );
  }

  const arrangement: Arrangement = local ?? { a: data.teamA.map((p) => p.membershipId), b: data.teamB.map((p) => p.membershipId) };
  const score = data.state === "none" ? null : scoreArrangement(data, arrangement);
  const editable = data.state === "draft" && !data.stale;

  function tap(id: string) {
    if (!editable || action.busy) return;
    if (picked === null || picked === id) return setPicked(picked === id ? null : id);
    if (arrangement.a.includes(picked) === arrangement.a.includes(id)) return setPicked(id); // same team: pick this one instead
    const first = picked;
    setLocal(swap(arrangement, first, id));
    setPicked(null);
    void action
      .run(async () => {
        await swapPlayers(client, matchId, first, id);
        await view.reload();
      })
      .then((saved) => saved || setLocal(null));
  }

  const regenerate = () => action.run(async () => (await generateDraftTeams(client, matchId), await view.reload()));
  const reshuffle = () => action.run(async () => (await reshuffleDraftTeams(client, matchId), await view.reload()));
  const publish = () =>
    action.run(async () => {
      await publishTeams(client, matchId);
      router.push(`/g/${groupId}`);
    });

  return (
    <main className="page">
      <header className="stack">
        <Link href={`/g/${groupId}`} className="muted">
          Back to the next match
        </Link>
        <h1>Teams</h1>
        <p className="muted">{formatWhen(data.match.startsAt)}</p>
      </header>

      {data.state === "none" && (
        <div className="stack">
          <p>{data.players.length} playing. Make teams from their Ratings, positions and your pair rules.</p>
          <button className="button primary block" disabled={action.busy || data.players.length < 2} onClick={regenerate}>
            Make teams
          </button>
        </div>
      )}

      {data.stale && (
        <p className="note" role="alert">
          Someone has dropped out or joined since you made these teams. Make them again before you publish.
        </p>
      )}
      {data.state === "published" && (
        <p className="note">
          These teams are published, so players can see them. To change them after a dropout, use the fix on the next match
          screen.
        </p>
      )}

      {score && <BalanceMeter score={score} />}
      {score && score.violations.length > 0 && <Violations violations={score.violations} byId={byId} />}

      {editable && (
        <p className="muted" aria-live="polite">
          {picked
            ? `${byId.get(picked)?.displayName} selected. Tap someone on the other team to swap.`
            : "Tap a player, then someone on the other team, to swap them."}
        </p>
      )}

      {data.state !== "none" && (
        <div className="assign" aria-label="Teams">
          <Side label="A" ids={arrangement.a} byId={byId} picked={picked} editable={editable} onTap={tap} />
          <Side label="B" ids={arrangement.b} byId={byId} picked={picked} editable={editable} onTap={tap} />
        </div>
      )}
      {data.state === "draft" && (
        <div className="stack">
          <p className="muted">Suggestion {data.rank + 1}. Only you can see these until you publish.</p>
          <button className="button primary block" disabled={action.busy || data.stale} onClick={publish}>
            Publish teams
          </button>
          <div className="row">
            <button className="button" disabled={action.busy || data.stale} onClick={reshuffle}>
              Next suggestion
            </button>
            <button className="button quiet" disabled={action.busy} onClick={() => setStartingAgain(true)}>
              Start again
            </button>
          </div>
          {startingAgain && (
            <Confirm
              question="Throw these teams away, including any swaps you've made, and make new ones?"
              yes="Make new teams"
              no="Keep these"
              busy={action.busy}
              onYes={async () => {
                if (await regenerate()) setStartingAgain(false);
              }}
              onNo={() => setStartingAgain(false)}
            />
          )}
        </div>
      )}
      <ErrorNote message={action.error} />
    </main>
  );
}

function BalanceMeter({ score }: { score: Score }) {
  const total = score.totalA + score.totalB;
  const share = total === 0 ? 50 : (score.totalA / total) * 100;
  const summary = `Team A ${score.totalA}, Team B ${score.totalB}. Gap ${score.gap}: ${TONE_LABEL[score.tone]}.`;
  return (
    <section className="meter" aria-label="Balance">
      <div className="row spread">
        <h2>Balance</h2>
        <p className={`gap gap-${score.tone}`}>
          {TONE_LABEL[score.tone]}, gap {score.gap}
        </p>
      </div>
      <div className="meter-track" role="img" aria-label={summary}>
        <div className="meter-a" style={{ width: `${share}%` }} />
        <div className="meter-b" />
      </div>
      <div className="row spread muted">
        <span>Team A {score.totalA}</span>
        <span>Team B {score.totalB}</span>
      </div>
      <p className="sr-only" role="status">
        {summary}
      </p>
    </section>
  );
}

function Violations({ violations, byId }: { violations: Violation[]; byId: Map<string, AssignedPlayer> }) {
  const name = (id: string) => byId.get(id)?.displayName ?? "Someone";
  const words = (v: Violation) => {
    switch (v.kind) {
      case "pair-together-broken":
        return `${name(v.a)} and ${name(v.b)} should be on the same team.`;
      case "pair-apart-broken":
        return `${name(v.a)} and ${name(v.b)} should be on opposite teams.`;
      case "no-happy-in-goal":
        return `Team ${v.team} has nobody happy in goal.`;
      case "position-imbalance":
        return `${POSITION_LABEL[v.position]}s are uneven by ${v.difference}.`;
    }
  };
  return (
    <ul className="issues" role="list" aria-label="Things to know about this split">
      {violations.map((v, i) => (
        <li key={i}>{words(v)}</li>
      ))}
    </ul>
  );
}

function Side({
  label,
  ids,
  byId,
  picked,
  editable,
  onTap,
}: {
  label: "A" | "B";
  ids: string[];
  byId: Map<string, AssignedPlayer>;
  picked: string | null;
  editable: boolean;
  onTap: (id: string) => void;
}) {
  const people = ids.map((id) => byId.get(id)).filter((p): p is AssignedPlayer => Boolean(p));
  return (
    <section aria-labelledby={`team-${label}`}>
      <h2 id={`team-${label}`}>
        <span className={`bib ${label === "B" ? "b" : ""}`} aria-hidden="true" /> Team {label}
      </h2>
      <ul className="players" role="list">
        {people.map((p) => {
          const tags = [p.position ? POSITION_LABEL[p.position] : null, p.happyInGoal ? "In goal" : null, p.isGuest ? "Guest" : null].filter(Boolean);
          return (
            <li key={p.membershipId}>
              <button
                className="player"
                aria-pressed={editable ? picked === p.membershipId : undefined}
                disabled={!editable}
                onClick={() => onTap(p.membershipId)}
              >
                <span className="player-name">{p.displayName}</span>
                {p.rating !== null && <span className="player-rating">{p.rating}</span>}
                {tags.length > 0 && <span className="player-tags">{tags.join(", ")}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
