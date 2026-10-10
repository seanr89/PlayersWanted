"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  confirmFix,
  dismissFix,
  generateDraftTeams,
  getProposedFix,
  openRsvps,
  publishTeams,
  recordResult,
} from "../../app-layer";
import { getShareMessage } from "../../app-layer/notifications";
import type { NextMatchView } from "../../app-layer/views";
import { ErrorNote, Field, Loading } from "../parts";
import { useSession } from "../session";
import { openShare } from "../share";
import { useAction } from "../use-action";
import { useAsync } from "../use-async";

type ShareKind = "rsvps_open" | "match_at_risk" | "teams_published";

/** The organiser's strip: the one next step for this match, and a way to share it with the group. */
export function AdminPanel({ groupId, view, onChanged }: { groupId: string; view: NextMatchView; onChanged: () => Promise<void> }) {
  const { client } = useSession();
  const action = useAction();
  const admin = view.admin!;
  const match = view.match;

  const then = (task: () => Promise<unknown>) =>
    action.run(async () => {
      await task();
      await onChanged();
    });
  const share = (kind: ShareKind) =>
    action.run(() => openShare(async () => (await getShareMessage(client, match!.id, kind)).whatsappUrl));

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
          <button className="button primary" disabled={action.busy} onClick={() => then(() => openRsvps(client, match!.id))}>
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
          <button className="button primary" disabled={action.busy} onClick={() => share("match_at_risk")}>
            Nudge the group on WhatsApp
          </button>
        </>
      );
      break;
    case "generate_teams":
      body = (
        <>
          <p>{admin.inCount} in. Ready to pick teams.</p>
          <button className="button primary" disabled={action.busy} onClick={() => then(() => generateDraftTeams(client, match!.id))}>
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
            <button className="button primary" disabled={action.busy} onClick={() => then(() => publishTeams(client, match!.id))}>
              Publish teams
            </button>
            <button className="button quiet" disabled={action.busy} onClick={() => then(() => generateDraftTeams(client, match!.id))}>
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
          <button className="button quiet" disabled={action.busy} onClick={() => share("teams_published")}>
            Share teams on WhatsApp
          </button>
        </>
      );
  }

  return (
    <section className="admin-strip" aria-label="Organiser">
      {body}
      {match && match.status === "rsvps_open" && admin.nextAction !== "nudge" && (
        <button className="button quiet" disabled={action.busy} onClick={() => share("rsvps_open")}>
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
      <ErrorNote message={action.error} />
    </section>
  );
}

function ReviewDropout({ matchId, onChanged }: { matchId: string; onChanged: () => Promise<void> }) {
  const { client } = useSession();
  const action = useAction();
  const fix = useAsync(() => getProposedFix(client, matchId), [client, matchId]);

  if (fix.loading) return <Loading />;
  if (!fix.data) return <p>Nothing to fix.</p>;
  const proposal = fix.data;
  const names = (people: { displayName: string }[]) => people.map((p) => p.displayName).join(", ");
  const decide = (task: () => Promise<unknown>) =>
    action.run(async () => {
      await task();
      await onChanged();
    });

  return (
    <>
      <p>
        <strong>{names(proposal.vacated)}</strong> dropped out.{" "}
        {proposal.promoted.length > 0 && <>{names(proposal.promoted)} comes off the waitlist. </>}
        {proposal.moved.length > 0 && <>{names(proposal.moved)} would switch teams to even it up. </>}
        The teams stay as published until you confirm.
      </p>
      <div className="row wrap">
        <button className="button primary" disabled={action.busy} onClick={() => decide(() => confirmFix(client, matchId, proposal))}>
          Confirm the fix
        </button>
        <button className="button quiet" disabled={action.busy} onClick={() => decide(() => dismissFix(client, matchId, proposal))}>
          Leave the teams as they are
        </button>
      </div>
      <ErrorNote message={action.error} />
    </>
  );
}

function RecordResult({ matchId, onChanged }: { matchId: string; onChanged: () => Promise<void> }) {
  const { client } = useSession();
  const action = useAction();
  const [a, setA] = useState("");
  const [b, setB] = useState("");

  return (
    <>
      <p>The game&apos;s started. Record the score when it&apos;s over.</p>
      <div className="score-row">
        <Field label="Team A">
          <input inputMode="numeric" type="number" min={0} value={a} onChange={(e) => setA(e.target.value)} />
        </Field>
        <span className="dash" aria-hidden="true">
          –
        </span>
        <Field label="Team B">
          <input inputMode="numeric" type="number" min={0} value={b} onChange={(e) => setB(e.target.value)} />
        </Field>
      </div>
      <button
        className="button primary"
        disabled={action.busy || a === "" || b === ""}
        onClick={() =>
          action.run(async () => {
            await recordResult(client, matchId, { scoreA: Number(a), scoreB: Number(b) });
            await onChanged();
          })
        }
      >
        Save the score
      </button>
      <ErrorNote message={action.error} />
    </>
  );
}
