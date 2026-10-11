"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { changePublishedTeams, generateDraftTeams, publishTeams, reshuffleDraftTeams, swapPlayers } from "../../app-layer";
import { getTeamAssignmentView, type AssignedPlayer, type TeamAssignmentView } from "../../app-layer/views";
import type { Violation } from "../../team-generator";
import { POSITION_LABEL, formatWhen } from "../format";
import { Confirm, ErrorNote, LoadingPage, useTitle } from "../parts";
import { useSession } from "../session";
import { useAction } from "../use-action";
import { useAsync } from "../use-async";
import { TONE_LABEL, hasBeenEdited, scoreArrangement, swap, unavailableReason, type Arrangement, type Score } from "./balance";

/**
 * Pick and tweak the teams. Tap a player, then a player on the other team, to swap them. The Balance meter updates
 * on the spot (scored on the device by the generator's own scoring); the swap is saved in the background and rolled
 * back if saving fails. Teams stay a private draft until published. Once published, an Admin can still change them
 * ("Change teams"), but there the swaps stay on the device until they save, so players are told once and never see
 * a half-finished arrangement.
 */
export function TeamAssignment({ groupId, matchId }: { groupId: string; matchId: string }) {
  const { client } = useSession();
  const router = useRouter();
  const view = useAsync(() => getTeamAssignmentView(client, matchId), [client, matchId], 30_000);
  const action = useAction();
  // An optimistic arrangement is only valid for the data it was made from; fresh data replaces it.
  const [local, setLocal] = useState<{ base: TeamAssignmentView; arrangement: Arrangement } | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [asking, setAsking] = useState<"next" | "again" | null>(null);
  // Edits to published teams, valid only for the teams they were started from (see `activeChange`).
  const [changing, setChanging] = useState<{ baseKey: string; arrangement: Arrangement } | null>(null);
  const [confirmSave, setConfirmSave] = useState(false);
  const [lostNote, setLostNote] = useState(false);
  // The arrangement (as a key) that was last saved, so "Saved" shows only while those are still the teams.
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  useTitle("Teams · Bibleague");

  const data = view.data;
  const byId = useMemo(() => new Map(data ? [...data.teamA, ...data.teamB].map((p) => [p.membershipId, p]) : []), [data]);

  const serverKey = data ? keyOf(arrangementOf(data)) : null;
  const canChange = data?.state === "published" && data.match.status === "teams_published" && !data.needsFix;
  // Unlike the draft, edits to published teams are not saved as you go, so they must survive the screen's refresh. They
  // are dropped only if the saved teams changed underneath them (another Admin's change, or a dropout).
  const lost = changing !== null && (!canChange || changing.baseKey !== serverKey);
  useEffect(() => {
    if (!lost) return;
    setChanging(null);
    setConfirmSave(false);
    setPicked(null);
    setLostNote(true);
  }, [lost]);

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

  const serverArrangement = arrangementOf(data);
  const activeChange = lost ? null : changing;
  const arrangement = activeChange?.arrangement ?? (local?.base === data ? local.arrangement : serverArrangement);
  const unchanged = keyOf(arrangement) === keyOf(serverArrangement);
  const reason = unavailableReason(data, arrangement);
  const score = data.state !== "none" && !reason ? scoreArrangement(data, arrangement) : null;
  const open = data.match.status === "rsvps_open";
  const editable = (data.state === "draft" && !data.stale && open) || activeChange !== null;
  const pickedId = picked && byId.has(picked) ? picked : null;

  const saveThenReload = (task: () => Promise<unknown>) =>
    action.run(async () => {
      await task();
      await view.reload();
    });

  async function tap(id: string) {
    if (!editable || action.busy) return;
    if (pickedId === null || pickedId === id) return setPicked(pickedId === id ? null : id);
    if (arrangement.a.includes(pickedId) === arrangement.a.includes(id)) return setPicked(id); // same team: pick this one instead
    const first = pickedId;
    setPicked(null);
    setAnnouncement(`Swapped ${byId.get(first)?.displayName} and ${byId.get(id)?.displayName}.`);
    // Keep focus on the player who moved, so keyboard and screen-reader users are not thrown back to the top.
    const refocus = () => focusSoon(`[data-player="${id}"]`);
    if (activeChange) {
      setConfirmSave(false);
      setChanging({ ...activeChange, arrangement: swap(arrangement, first, id) });
      return refocus();
    }
    setLocal({ base: data!, arrangement: swap(arrangement, first, id) });
    refocus();
    const saved = await saveThenReload(() => swapPlayers(client, matchId, first, id));
    if (saved) refocus();
    else {
      setLocal(null);
      setAnnouncement("That swap couldn't be saved, so it was undone.");
    }
  }

  const startOver = async (task: () => Promise<unknown>) => {
    setPicked(null);
    setAnnouncement("");
    return saveThenReload(task);
  };
  const startChanging = () => {
    setPicked(null);
    setAnnouncement("");
    setLostNote(false);
    setChanging({ baseKey: keyOf(serverArrangement), arrangement: serverArrangement });
    focusSoon("[data-player]");
  };
  const stopChanging = (announce: string) => {
    setChanging(null);
    setPicked(null);
    setConfirmSave(false);
    setAnnouncement(announce);
    focusSoon('[data-focus="change"]');
  };
  const saveChanges = async () => {
    const saved = await action.run(async () => {
      await changePublishedTeams(client, matchId, { teamA: arrangement.a, teamB: arrangement.b, revision: data.revision });
      // Leave change mode before reloading: the reloaded teams would otherwise look like they changed under the edits.
      setChanging(null);
      await view.reload();
    });
    if (saved) {
      setSavedKey(keyOf(arrangement));
      stopChanging("Teams changed. Players have been told.");
    }
  };
  const regenerate = () => startOver(() => generateDraftTeams(client, matchId));
  const reshuffle = () => startOver(() => reshuffleDraftTeams(client, matchId));
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
          {data.players.length < 2 && <p className="note">You need at least 2 players to make teams.</p>}
          <button className="button primary block" disabled={action.busy || data.players.length < 2 || !open} onClick={regenerate}>
            Make teams
          </button>
        </div>
      )}

      {data.stale && (
        <p className="note" role="alert">
          Someone has dropped out or joined since you made these teams. Make them again before you publish.
        </p>
      )}
      {!open && data.state !== "published" && (
        <p className="note">This match is {data.match.status.replace("_", " ")}, so its teams can&apos;t be changed.</p>
      )}
      {data.state === "published" && !activeChange && (
        <p className="note">
          {data.needsFix
            ? "Someone on these teams has dropped out. Confirm the fix on the next match screen before changing the teams."
            : "These teams are published, so players can see them. After a dropout, use the fix on the next match screen."}
        </p>
      )}
      {activeChange && (
        <p className="note">
          You&apos;re changing the published teams. Nothing changes for players until you save.
          {unchanged && " Swap two players to enable Save."}
        </p>
      )}
      {lostNote && !activeChange && (
        <p className="note" role="alert">
          These teams changed while you were editing, so your edits were dropped.
        </p>
      )}
      {savedKey !== null && savedKey === serverKey && !activeChange && (
        <p className="note">Saved. Players have been told the teams changed.</p>
      )}
      {reason === "left" && (
        <p className="note">Someone on these teams has left the group, so the balance can&apos;t be worked out.</p>
      )}

      {score && <BalanceMeter score={score} announcement={announcement} />}
      {score && score.violations.length > 0 && <Violations violations={score.violations} byId={byId} />}

      {editable && (
        <p className="muted">
          {pickedId
            ? `${byId.get(pickedId)?.displayName} selected. Tap someone on the other team to swap.`
            : "Tap a player, then someone on the other team, to swap them."}
        </p>
      )}

      {data.state !== "none" && (
        <div className="assign" role="group" aria-label="Teams">
          <Side label="A" ids={arrangement.a} byId={byId} picked={pickedId} editable={editable} onTap={tap} />
          <Side label="B" ids={arrangement.b} byId={byId} picked={pickedId} editable={editable} onTap={tap} />
        </div>
      )}

      {canChange &&
        (activeChange ? (
          <div className="stack">
            <button
              className="button primary block"
              data-focus="save"
              disabled={action.busy || unchanged}
              onClick={() => setConfirmSave(true)}
            >
              Save changes
            </button>
            <button className="button quiet block" disabled={action.busy} onClick={() => stopChanging("Changes discarded.")}>
              Cancel
            </button>
            {confirmSave && (
              <Confirm
                question="Save these teams? Players are told straight away that the teams have changed."
                yes="Save and tell players"
                no="Keep editing"
                busy={action.busy}
                onYes={saveChanges}
                onNo={() => {
                  setConfirmSave(false);
                  focusSoon('[data-focus="save"]');
                }}
              />
            )}
          </div>
        ) : (
          <button className="button block" data-focus="change" disabled={action.busy} onClick={startChanging}>
            Change teams
          </button>
        ))}

      {data.state === "draft" && (
        <div className="stack">
          <p className="muted">Suggestion {data.rank + 1}. Only you can see these until you publish.</p>
          <button className="button primary block" disabled={action.busy || data.stale || !open} onClick={publish}>
            Publish teams
          </button>
          <div className="row">
            <button
              className="button"
              disabled={action.busy || data.stale || !open}
              onClick={() => (hasBeenEdited(data, arrangement) ? setAsking("next") : reshuffle())}
            >
              Next suggestion
            </button>
            <button className="button quiet" disabled={action.busy || !open} onClick={() => setAsking("again")}>
              Start again
            </button>
          </div>
          {asking && (
            <Confirm
              question={
                asking === "next"
                  ? "Swap in the next suggestion? It replaces the swaps you've made."
                  : "Throw these teams away, including any swaps you've made, and make new ones?"
              }
              yes={asking === "next" ? "Show the next suggestion" : "Make new teams"}
              no="Keep these"
              busy={action.busy}
              onYes={async () => {
                if (await (asking === "next" ? reshuffle() : regenerate())) setAsking(null);
              }}
              onNo={() => setAsking(null)}
            />
          )}
        </div>
      )}
      <ErrorNote message={action.error ?? view.error} />
    </main>
  );
}

const arrangementOf = (view: TeamAssignmentView): Arrangement => ({
  a: view.teamA.map((p) => p.membershipId),
  b: view.teamB.map((p) => p.membershipId),
});

/** Moves keyboard focus once React has put the new screen in place. */
const focusSoon = (selector: string) => requestAnimationFrame(() => document.querySelector<HTMLElement>(selector)?.focus());

/** The same teams, whatever order they are listed in. Which side a player is on matters, so A and B stay distinct. */
const keyOf = (arrangement: Arrangement) => `${[...arrangement.a].sort().join(",")}|${[...arrangement.b].sort().join(",")}`;

function BalanceMeter({ score, announcement }: { score: Score; announcement: string }) {
  const total = score.totalA + score.totalB;
  const share = total === 0 ? 50 : (score.totalA / total) * 100;
  const issues = score.violations.length;
  const summary = `Team A ${score.totalA}, Team B ${score.totalB}. Gap ${score.gap}: ${TONE_LABEL[score.tone]}.${issues > 0 ? ` ${issues} ${issues === 1 ? "thing" : "things"} to know.` : ""}`;
  return (
    <section className="meter" aria-labelledby="balance-heading">
      <div className="row spread">
        <h2 id="balance-heading">Balance</h2>
        <p className={`gap gap-${score.tone}`}>
          {TONE_LABEL[score.tone]}, gap {score.gap}
        </p>
      </div>
      <div className="meter-track" aria-hidden="true">
        <div className="meter-a" style={{ width: `${share}%` }} />
        <div className="meter-b" />
      </div>
      <div className="row spread muted" aria-hidden="true">
        <span>Team A {score.totalA}</span>
        <span>Team B {score.totalB}</span>
      </div>
      {/* The one place changes are announced: what just happened, then where the balance stands. */}
      <p className="sr-only" role="status">
        {announcement} {summary}
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
  // A fixed order (by name) so the optimistic swap and the saved result line up, and nothing jumps when the save lands.
  const people = ids
    .map((id) => byId.get(id))
    .filter((p): p is AssignedPlayer => Boolean(p))
    .sort((x, y) => x.displayName.localeCompare(y.displayName));
  return (
    <section aria-labelledby={`team-${label}`}>
      <h2 id={`team-${label}`}>
        <span className={`bib ${label === "B" ? "b" : ""}`} aria-hidden="true" /> Team {label}
      </h2>
      <ul className="players" role="list">
        {people.map((p) => (
          <li key={p.membershipId}>
            <PlayerCard player={p} selected={picked === p.membershipId} editable={editable} onTap={onTap} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function PlayerCard({
  player,
  selected,
  editable,
  onTap,
}: {
  player: AssignedPlayer;
  selected: boolean;
  editable: boolean;
  onTap: (id: string) => void;
}) {
  const tags = [player.position ? POSITION_LABEL[player.position] : null, player.happyInGoal ? "In goal" : null, player.isGuest ? "Guest" : null].filter(Boolean);
  const content = (
    <>
      <span className="player-name">{player.displayName}</span>
      {player.rating !== null && (
        <span className="player-rating">
          <span className="sr-only">, rating </span>
          {player.rating}
        </span>
      )}
      {tags.length > 0 && (
        <span className="player-tags">
          <span className="sr-only">, </span>
          {tags.join(", ")}
        </span>
      )}
    </>
  );
  // Read-only teams are plain text, not dimmed buttons that do nothing.
  if (!editable) return <div className="player static">{content}</div>;
  return (
    <button className="player" data-player={player.membershipId} aria-pressed={selected} onClick={() => onTap(player.membershipId)}>
      {content}
    </button>
  );
}
