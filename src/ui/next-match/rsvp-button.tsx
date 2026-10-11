"use client";

import { useState } from "react";
import { setRsvp, type Match } from "../../app-layer";
import type { NextMatchView } from "../../app-layer/views";
import { RSVPS_ACCEPTED } from "../format";
import { Confirm, ErrorNote } from "../parts";
import { useSession } from "../session";
import { useAction } from "../use-action";

type State = "out" | "in" | "waitlist";

/** The centre circle. Saying you're in is one tap; pulling out asks first, because it can leave a hole. */
export function RsvpButton({
  match,
  myRsvp,
  onChanged,
}: {
  match: Match;
  myRsvp: NextMatchView["myRsvp"];
  onChanged: () => Promise<void>;
}) {
  const { client } = useSession();
  const action = useAction();
  const [confirming, setConfirming] = useState(false);
  const open = (RSVPS_ACCEPTED as readonly string[]).includes(match.status);
  const state: State = myRsvp.response !== "in" ? "out" : myRsvp.status === "waitlist" ? "waitlist" : "in";

  const say = (response: "in" | "out") =>
    action.run(async () => {
      await setRsvp(client, match.id, response);
      setConfirming(false);
      await onChanged();
    });

  // Read out when it changes, so someone using a screen reader hears the result of the tap.
  const spoken =
    state === "in"
      ? "You're in."
      : state === "waitlist"
        ? `You're number ${myRsvp.waitlistPosition} on the waitlist.`
        : myRsvp.response === "out"
          ? "You've pulled out."
          : "";

  return (
    <div className="stack">
      <div className="centre-spot">
        <button
          className="in-button"
          data-state={state}
          disabled={!open || action.busy}
          onClick={() => (state === "out" ? say("in") : setConfirming(true))}
        >
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
              Waitlist {myRsvp.waitlistPosition}
              <small>Tap to leave the queue</small>
            </>
          ) : myRsvp.response === "out" ? (
            <>
              I&apos;m in
              <small>You pulled out. Tap to change</small>
            </>
          ) : (
            <>I&apos;m in</>
          )}
        </button>
      </div>
      <p className="sr-only" role="status">
        {spoken}
      </p>
      {confirming && (
        <Confirm
          question={
            state === "waitlist"
              ? "Leave the waitlist?"
              : match.status === "teams_published"
                ? "Pull out? The teams are already out, so the organiser will have to confirm a change."
                : "Pull out of this game?"
          }
          yes={state === "waitlist" ? "Leave the waitlist" : "Pull out"}
          no="Stay in"
          busy={action.busy}
          onYes={() => say("out")}
          onNo={() => setConfirming(false)}
        />
      )}
      <ErrorNote message={action.error} />
    </div>
  );
}
