"use client";

import { getNextMatchView } from "../../app-layer/views";
import { ErrorNote, LoadingPage, useTitle } from "../parts";
import { useSession } from "../session";
import { useAsync } from "../use-async";
import { AdminPanel } from "./admin-panel";
import { Facts, MatchLine, Teams, WhosIn } from "./match-panels";
import { RsvpButton } from "./rsvp-button";

/** The home screen of a Group: one huge button for players, one clear next step for the organiser. */
export function NextMatch({ groupId }: { groupId: string }) {
  const { client } = useSession();
  const state = useAsync(() => getNextMatchView(client, groupId), [client, groupId], 20_000);
  useTitle(state.data ? `Next match · ${state.data.groupName}` : undefined);

  if (state.loading && !state.data) return <LoadingPage />;
  if (!state.data) {
    return (
      <main className="page">
        <h1>Next match</h1>
        <ErrorNote message={state.error} />
      </main>
    );
  }
  const view = state.data;
  const { match } = view;

  return (
    <main className="page pitch">
      <header className="stack">
        <h1>{view.groupName}</h1>
        {match && <MatchLine match={match} />}
      </header>

      {view.me.claim === "pending" && (
        <p className="note">An organiser needs to confirm you&apos;re {view.me.displayName}. You can still say you&apos;re in.</p>
      )}
      {view.admin && <AdminPanel groupId={groupId} view={view} onChanged={state.reload} />}

      {match ? (
        <>
          <RsvpButton match={match} myRsvp={view.myRsvp} onChanged={state.reload} />
          <Facts match={match} counts={view.counts} />
          {view.teams && <Teams view={view} />}
          <WhosIn people={view.whosIn} />
        </>
      ) : (
        !view.admin && (
          <div className="stack">
            <h2>No game scheduled yet</h2>
            <p className="muted">When the organiser sets up the next one, it will show up here.</p>
          </div>
        )
      )}
      <ErrorNote message={state.error} />
    </main>
  );
}
