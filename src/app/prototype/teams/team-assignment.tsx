"use client";

import { useMemo, useState } from "react";
import { generateTeams, scoreSplit, type Teams, type Violation } from "../../../team-generator";
import { SAMPLE_NAMES, SAMPLE_PLAYERS, SAMPLE_RULES } from "./sample-squad";

const name = (id: string) => SAMPLE_NAMES[id] ?? id;

/** Placeholder scale for the Balance meter: to be confirmed during the build. */
function gapTone(gap: number): { className: string; label: string } {
  if (gap <= 5) return { className: "gap-even", label: "Even" };
  if (gap <= 15) return { className: "gap-close", label: "Close" };
  return { className: "gap-wide", label: "Lopsided" };
}

function describe(v: Violation): string {
  switch (v.kind) {
    case "pair-together-broken":
      return `${name(v.a)} and ${name(v.b)} should be together`;
    case "pair-apart-broken":
      return `${name(v.a)} and ${name(v.b)} should be apart`;
    case "no-happy-in-goal":
      return `Team ${v.team} has nobody happy in goal`;
    case "position-imbalance":
      return `${v.position}s are uneven by ${v.difference}`;
  }
}

export function TeamAssignment() {
  const ranked = useMemo(() => generateTeams(SAMPLE_PLAYERS, SAMPLE_RULES, { limit: 50 }), []);
  const [rank, setRank] = useState(0);
  const [teams, setTeams] = useState<Teams>(() => ({ teamA: ranked[0]!.teamA, teamB: ranked[0]!.teamB }));
  const [picked, setPicked] = useState<string | null>(null);

  const current = useMemo(
    () => scoreSplit(SAMPLE_PLAYERS, SAMPLE_RULES, teams.teamA, teams.teamB),
    [teams],
  );
  const ratingOf = (id: string) => SAMPLE_PLAYERS.find((p) => p.id === id)!.rating;
  const total = (ids: string[]) => ids.reduce((sum, id) => sum + ratingOf(id), 0);
  const totalA = total(teams.teamA);
  const totalB = total(teams.teamB);
  const tone = gapTone(current.balance);

  function loadRank(next: number) {
    const split = ranked[next]!;
    setRank(next);
    setTeams({ teamA: split.teamA, teamB: split.teamB });
    setPicked(null);
  }

  function tap(id: string) {
    if (picked === null || picked === id) {
      setPicked(picked === id ? null : id);
      return;
    }
    const pickedInA = teams.teamA.includes(picked);
    const tappedInA = teams.teamA.includes(id);
    if (pickedInA === tappedInA) {
      setPicked(id);
      return;
    }
    const swap = (list: string[]) => list.map((p) => (p === picked ? id : p === id ? picked : p));
    setTeams({ teamA: swap(teams.teamA), teamB: swap(teams.teamB) });
    setPicked(null);
  }

  function side(label: "A" | "B", ids: string[], sum: number) {
    return (
      <section className="team" aria-label={`Team ${label}`}>
        <h2>
          <span>Team {label}</span>
          <span>{sum}</span>
        </h2>
        {ids.map((id) => {
          const player = SAMPLE_PLAYERS.find((p) => p.id === id)!;
          const tags = [player.position, player.happyInGoal ? "keeper" : undefined].filter(Boolean).join(" · ");
          return (
            <button key={id} className="chip" aria-pressed={picked === id} onClick={() => tap(id)}>
              <span>
                {name(id)}
                <span className="tags"> {tags}</span>
              </span>
              <strong>{player.rating}</strong>
            </button>
          );
        })}
      </section>
    );
  }

  return (
    <>
      <div className="meter" role="status" aria-live="polite">
        <div className="meter-gap">
          <span>Balance</span>
          <span className={tone.className}>
            {tone.label} · gap {current.balance}
          </span>
        </div>
        <div className="meter-track" aria-hidden="true">
          <div className="meter-a" style={{ width: `${(totalA / (totalA + totalB)) * 100}%` }} />
          <div className="meter-b" />
        </div>
        <div className="meter-gap muted">
          <span>Team A {totalA}</span>
          <span>Team B {totalB}</span>
        </div>
      </div>

      <div className="teams">
        {side("A", teams.teamA, totalA)}
        {side("B", teams.teamB, totalB)}
      </div>

      {current.violations.length > 0 && (
        <ul className="violations">
          {current.violations.map((v, i) => (
            <li key={i}>{describe(v)}</li>
          ))}
        </ul>
      )}

      <div className="row">
        <button className="button secondary" onClick={() => loadRank(rank)}>
          Reset
        </button>
        <button className="button" disabled={rank + 1 >= ranked.length} onClick={() => loadRank(rank + 1)}>
          Reshuffle (#{rank + 2})
        </button>
      </div>
      <p className="muted">Showing split #{rank + 1} of the best {ranked.length}. Draft only: nothing is published.</p>
    </>
  );
}
