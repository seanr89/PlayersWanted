import { gameFromData } from '@pw/shared';
import { collection, limit, orderBy, query, Timestamp, where } from 'firebase/firestore';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { AreaSelect } from '../components/AreaSelect';
import { GameCard } from '../components/GameCard';
import { db } from '../firebase';
import { useAreas, useLiveQuery } from '../lib/hooks';

export function GamesList() {
  const { user, profile } = useAuth();
  const areas = useAreas();
  const [params, setParams] = useSearchParams();
  const areaId = params.get('area') ?? profile?.homeAreaId ?? areas.data[0]?.id ?? null;

  const games = useLiveQuery(
    () =>
      areaId
        ? query(
            collection(db, 'games'),
            where('areaId', '==', areaId),
            where('status', '==', 'scheduled'),
            where('startsAt', '>=', Timestamp.now()),
            orderBy('startsAt'),
            limit(50),
          )
        : null,
    (d) => gameFromData(d.id, d.data()),
    [areaId],
  );

  return (
    <section>
      <div className="row">
        <h1>Upcoming games</h1>
        {user && (
          <Link className="button" to="/games/new">
            Post a game
          </Link>
        )}
      </div>
      {areaId && (
        <>
          <label htmlFor="area">Area</label>
          <AreaSelect id="area" value={areaId} areas={areas.data} onChange={(id) => setParams({ area: id })} />
        </>
      )}
      <div style={{ marginTop: 16 }}>
        {games.loading && <p className="muted">Loading games…</p>}
        {games.error && <p className="error">Couldn't load games. Pull to refresh or try again later.</p>}
        {!games.loading && games.data.length === 0 && (
          <p className="muted">No upcoming games here yet. {user ? 'Post one!' : 'Sign in to post one.'}</p>
        )}
        {games.data.map((g) => (
          <GameCard key={g.id} game={g} />
        ))}
      </div>
    </section>
  );
}
