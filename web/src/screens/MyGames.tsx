import { gameFromData, participantFromData, type Game } from '@pw/shared';
import { collection, collectionGroup, doc, getDoc, orderBy, query, where } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { GameCard } from '../components/GameCard';
import { db } from '../firebase';
import { useLiveQuery } from '../lib/hooks';

export function MyGames() {
  const { user } = useAuth();
  const uid = user?.uid ?? '';

  const organising = useLiveQuery(
    () => query(collection(db, 'games'), where('organiserUid', '==', uid), orderBy('startsAt', 'desc')),
    (d) => gameFromData(d.id, d.data()),
    [uid],
  );
  const playing = useLiveQuery(
    () => query(collectionGroup(db, 'participants'), where('uid', '==', uid), orderBy('gameStartsAt', 'desc')),
    (d) => ({ gameId: d.ref.parent.parent!.id, participant: participantFromData(d.data()) }),
    [uid],
  );

  const playingIds = playing.data.map((p) => p.gameId).join(',');
  const [playedGames, setPlayedGames] = useState<Game[]>([]);
  useEffect(() => {
    const ids = playingIds ? playingIds.split(',') : [];
    void Promise.all(ids.map((id) => getDoc(doc(db, 'games', id)))).then((snaps) =>
      setPlayedGames(snaps.filter((s) => s.exists()).map((s) => gameFromData(s.id, s.data()!))),
    );
  }, [playingIds]);

  const { upcoming, past } = useMemo(() => {
    const byId = new Map<string, Game>();
    for (const g of [...organising.data, ...playedGames]) byId.set(g.id, g);
    const now = Date.now();
    const all = [...byId.values()];
    return {
      upcoming: all.filter((g) => g.startsAt >= now).sort((a, b) => a.startsAt - b.startsAt),
      past: all.filter((g) => g.startsAt < now).sort((a, b) => b.startsAt - a.startsAt),
    };
  }, [organising.data, playedGames]);

  const loading = organising.loading || playing.loading;
  return (
    <section>
      <h1>My games</h1>
      {loading && <p className="muted">Loading…</p>}
      <h2>Upcoming</h2>
      {!loading && upcoming.length === 0 && <p className="muted">Nothing coming up.</p>}
      {upcoming.map((g) => (
        <GameCard key={g.id} game={g} />
      ))}
      <h2>Past</h2>
      {!loading && past.length === 0 && <p className="muted">No past games yet.</p>}
      {past.map((g) => (
        <GameCard key={g.id} game={g} />
      ))}
    </section>
  );
}
