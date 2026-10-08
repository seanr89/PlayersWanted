import { formatKickoff, formatPence, gameFromData, gameLabel, participantFromData, spacesLabel, type Game } from '@pw/shared';
import { collection } from 'firebase/firestore';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Roster } from '../components/Roster';
import { db } from '../firebase';
import { primaryAction } from '../lib/actions';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { useLiveDoc, useLiveQuery } from '../lib/hooks';
import { useOnline } from '../lib/useOnline';

function mapsLink(game: Game): string {
  return game.venue.mapsUrl ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(game.venue.address)}`;
}

export function GameDetail() {
  const { gameId = '' } = useParams();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const online = useOnline();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const game = useLiveDoc(`games/${gameId}`, (d) => (d.exists() ? gameFromData(d.id, d.data()) : null));
  const roster = useLiveQuery(
    () => (user ? collection(db, 'games', gameId, 'participants') : null),
    (d) => participantFromData(d.data()),
    [gameId, user?.uid],
  );

  if (game.loading) return <p className="muted">Loading…</p>;
  if (!game.data) return <p>This game doesn't exist or was deleted.</p>;
  const g = game.data;
  const isOrganiser = user?.uid === g.organiserUid;
  const me = roster.data.find((p) => p.uid === user?.uid);
  const action = primaryAction(g, me, Boolean(user), Date.now());

  async function run(fn: () => Promise<unknown>, success?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (success) setNotice(success);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    const url = `${window.location.origin}/games/${g.id}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'PlayersWanted', text: gameLabel(g), url });
      } catch {
        // The user closed the share sheet.
      }
      return;
    }
    await navigator.clipboard.writeText(url);
    setNotice('Link copied');
  }

  function onPrimary() {
    switch (action.kind) {
      case 'join':
      case 'join-waitlist':
        return run(async () => {
          const { state } = await api.joinGame({ gameId });
          setNotice(state === 'confirmed' ? "You're in!" : "You're on the waitlist. We'll tell you if a space opens.");
        });
      case 'leave':
      case 'leave-waitlist':
        if (!window.confirm('Leave this game?')) return;
        return run(() => api.leaveGame({ gameId }), 'You left the game.');
      default:
        return undefined;
    }
  }

  return (
    <section>
      {g.status === 'cancelled' && <p className="card error">This game was cancelled.</p>}
      <h1>{formatKickoff(g.startsAt)}</h1>
      <p>
        <strong>{g.venue.name}</strong>
        <br />
        <a href={mapsLink(g)} target="_blank" rel="noreferrer">
          {g.venue.address}
        </a>
      </p>
      <p className="muted">
        {g.format} · {g.durationMins} mins · {formatPence(g.costPerPlayerPence)} each · {spacesLabel(g)}
        <br />
        Organised by {g.organiserName}
      </p>
      {g.notes && <p>{g.notes}</p>}

      <div className="row" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
        {action.kind === 'sign-in' && (
          <Link className="button" to={`/sign-in?next=${encodeURIComponent(`/games/${g.id}`)}`}>
            {action.label}
          </Link>
        )}
        {action.kind !== 'sign-in' && action.kind !== 'none' && (
          <button onClick={onPrimary} disabled={busy || !online} className={action.kind.startsWith('leave') ? 'secondary' : ''}>
            {action.label}
          </button>
        )}
        {action.kind === 'none' && <span className="muted">{action.label}</span>}
        <button className="secondary" onClick={share}>
          Share
        </button>
      </div>
      {!online && <p className="muted">You're offline — actions are disabled.</p>}
      {params.get('created') === '1' && isOrganiser && !me && action.kind === 'join' && (
        <p className="card">
          Game posted. Playing too?{' '}
          <button onClick={onPrimary} disabled={busy || !online}>
            Join as player
          </button>
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && <p className="error">{error}</p>}

      {isOrganiser && g.status === 'scheduled' && (
        <div className="row" style={{ justifyContent: 'flex-start', marginTop: 12 }}>
          <Link className="button secondary" to={`/games/${g.id}/edit`}>
            Edit
          </Link>
          <button
            className="danger"
            disabled={busy || !online}
            onClick={() => {
              if (window.confirm('Cancel this game? Everyone on it will be notified.')) {
                void run(() => api.cancelGame({ gameId }), 'Game cancelled.');
              }
            }}
          >
            Cancel game
          </button>
        </div>
      )}

      {user ? (
        <Roster
          participants={roster.data}
          isOrganiser={isOrganiser}
          busy={busy || !online}
          onRemove={(uid) => {
            if (window.confirm('Remove this player?')) void run(() => api.removePlayer({ gameId, uid }));
          }}
          onTogglePaid={(uid, paid) => void run(() => api.setPaid({ gameId, uid, paid }))}
        />
      ) : (
        <p className="muted">Sign in to see who's playing.</p>
      )}
    </section>
  );
}
