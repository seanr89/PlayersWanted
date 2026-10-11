"use client";

import { useId, useState, type FormEvent } from "react";
import { setHappyInGoal, setPosition, setRating, type SquadMember } from "../../app-layer";
import { POSITION_LABEL } from "../format";
import { ErrorNote } from "../parts";
import { DEFAULT_RATING, RATING_BANDS, bandFor } from "../rating";
import { useSession } from "../session";
import { useAction } from "../use-action";

type Position = SquadMember["position"];

/** An Admin's editor for one player: Rating (slider with labelled bands), position tag and happy-in-goal. Saves only what changed. */
export function PlayerEditor({ member, onSaved, onCancel }: { member: SquadMember; onSaved: () => Promise<void>; onCancel: () => void }) {
  const { client } = useSession();
  const action = useAction();
  const id = useId();
  const startRating = member.rating ?? DEFAULT_RATING;
  const [rating, setRatingValue] = useState(startRating);
  const [position, setPositionValue] = useState<Position>(member.position);
  const [happy, setHappy] = useState(member.happyInGoal);
  const band = bandFor(rating);
  const changed = rating !== startRating || position !== member.position || happy !== member.happyInGoal;

  async function save(e: FormEvent) {
    e.preventDefault();
    const saved = await action.run(async () => {
      if (rating !== startRating) await setRating(client, member.id, rating);
      if (position !== member.position) await setPosition(client, member.id, position);
      if (happy !== member.happyInGoal) await setHappyInGoal(client, member.id, happy);
      await onSaved();
    });
    if (saved) onCancel();
  }

  return (
    <form className="editor stack" onSubmit={save} aria-label={`Edit ${member.displayName}`}>
      <div className="field">
        <label htmlFor={`${id}-rating`}>
          Rating <output htmlFor={`${id}-rating`}>{rating}</output>
          <span className="band"> · {band.label}</span>
        </label>
        <input
          id={`${id}-rating`}
          type="range"
          min={1}
          max={100}
          step={1}
          value={rating}
          aria-valuetext={`${rating}, ${band.label}`}
          aria-describedby={`${id}-bands`}
          onChange={(e) => setRatingValue(Number(e.target.value))}
        />
        <ul id={`${id}-bands`} className="bands field-hint">
          {RATING_BANDS.map((b) => (
            <li key={b.from} aria-current={b === band ? "true" : undefined}>
              {b.from}–{b.to} {b.label}
            </li>
          ))}
        </ul>
        <span className="field-hint">Only admins ever see Ratings.</span>
      </div>
      <div className="field">
        <label htmlFor={`${id}-position`}>Position</label>
        <select
          id={`${id}-position`}
          value={position ?? ""}
          onChange={(e) => setPositionValue(e.target.value === "" ? null : (e.target.value as NonNullable<Position>))}
        >
          <option value="">No set position</option>
          {(Object.keys(POSITION_LABEL) as NonNullable<Position>[]).map((p) => (
            <option key={p} value={p}>
              {POSITION_LABEL[p]}
            </option>
          ))}
        </select>
      </div>
      <label className="check">
        <input type="checkbox" checked={happy} onChange={(e) => setHappy(e.target.checked)} />
        Happy to play in goal
      </label>
      <ErrorNote message={action.error} />
      <div className="row">
        <button className="button primary" disabled={action.busy || !changed}>
          {action.busy ? "Saving…" : "Save"}
        </button>
        <button type="button" className="button quiet" disabled={action.busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** A player's own "happy in goal" switch: the one thing about themselves they may change. Saves as soon as it is ticked. */
export function HappyInGoalToggle({ member, onSaved }: { member: SquadMember; onSaved: () => Promise<void> }) {
  const { client } = useSession();
  const action = useAction();
  return (
    <div className="stack">
      <label className="check">
        <input
          type="checkbox"
          checked={member.happyInGoal}
          disabled={action.busy}
          onChange={(e) =>
            action.run(async () => {
              await setHappyInGoal(client, member.id, e.target.checked);
              await onSaved();
            })
          }
        />
        I&apos;m happy to play in goal
      </label>
      <ErrorNote message={action.error} />
    </div>
  );
}
