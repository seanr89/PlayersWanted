import { FORMATS, gameFromData, GAME_LIMITS, parsePounds, type Format, type GameInput } from '@pw/shared';
import { doc, getDoc } from 'firebase/firestore';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { AreaSelect } from '../components/AreaSelect';
import { VenuePicker } from '../components/VenuePicker';
import { db } from '../firebase';
import { api } from '../lib/api';
import { fromLocalInput, toLocalInput } from '../lib/datetime';
import { errorMessage } from '../lib/errors';
import { useAreas } from '../lib/hooks';
import { useOnline } from '../lib/useOnline';

const CAPACITIES = Array.from(
  { length: (GAME_LIMITS.capacity.max - GAME_LIMITS.capacity.min) / 2 + 1 },
  (_, i) => GAME_LIMITS.capacity.min + i * 2,
);

export function GameForm() {
  const { gameId } = useParams();
  const editing = Boolean(gameId);
  const { user, profile } = useAuth();
  const areas = useAreas();
  const online = useOnline();
  const navigate = useNavigate();

  const [loaded, setLoaded] = useState(!editing);
  const [areaId, setAreaId] = useState(profile?.homeAreaId ?? '');
  const [venueId, setVenueId] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [originalStart, setOriginalStart] = useState<number | null>(null);
  const [durationMins, setDurationMins] = useState(60);
  const [format, setFormat] = useState<Format>('5v5');
  const [capacity, setCapacity] = useState(10);
  const [cost, setCost] = useState('5');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!gameId) return;
    void getDoc(doc(db, 'games', gameId)).then((snap) => {
      if (!snap.exists()) {
        setError('This game no longer exists.');
        return;
      }
      const g = gameFromData(snap.id, snap.data());
      if (g.organiserUid !== user?.uid) {
        setError('Only the organiser can edit this game.');
        return;
      }
      setAreaId(g.areaId);
      setVenueId(g.venueId);
      setStartsAt(toLocalInput(g.startsAt));
      setOriginalStart(g.startsAt);
      setDurationMins(g.durationMins);
      setFormat(g.format);
      setCapacity(g.capacity);
      setCost((g.costPerPlayerPence / 100).toFixed(2));
      setNotes(g.notes ?? '');
      setLoaded(true);
    });
  }, [gameId, user?.uid]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const start = fromLocalInput(startsAt);
    const pence = parsePounds(cost);
    if (start === null) return setError('Choose a kick-off date and time.');
    if (pence === null) return setError('Enter the cost in pounds, e.g. 5 or 4.50.');
    // Keep the exact original millisecond value when the time wasn't edited.
    const startMs = originalStart !== null && toLocalInput(originalStart) === startsAt ? originalStart : start;
    const input: GameInput = {
      venueId,
      startsAt: startMs,
      durationMins,
      format,
      capacity,
      costPerPlayerPence: pence,
      notes: notes.trim() || null,
    };
    setBusy(true);
    try {
      if (gameId) {
        await api.updateGame({ gameId, ...input });
        navigate(`/games/${gameId}`);
      } else {
        const { gameId: created } = await api.createGame(input);
        navigate(`/games/${created}?created=1`);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>;
  const selectedArea = areaId || areas.data[0]?.id || '';

  return (
    <form onSubmit={submit}>
      <h1>{editing ? 'Edit game' : 'Post a game'}</h1>
      <label htmlFor="area">Area</label>
      <AreaSelect id="area" value={selectedArea} areas={areas.data} onChange={(id) => { setAreaId(id); setVenueId(''); }} />
      {selectedArea && <VenuePicker areaId={selectedArea} value={venueId} onChange={setVenueId} />}
      <label htmlFor="starts">Kick-off</label>
      <input id="starts" type="datetime-local" required value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
      <label htmlFor="duration">Duration (minutes)</label>
      <select id="duration" value={durationMins} onChange={(e) => setDurationMins(Number(e.target.value))}>
        {[30, 45, 60, 75, 90, 120, 150, 180].map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <label htmlFor="format">Format</label>
      <select id="format" value={format} onChange={(e) => setFormat(e.target.value as Format)}>
        {FORMATS.map((f) => (
          <option key={f}>{f}</option>
        ))}
      </select>
      <label htmlFor="capacity">Players needed (total)</label>
      <select id="capacity" value={capacity} onChange={(e) => setCapacity(Number(e.target.value))}>
        {CAPACITIES.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
      <label htmlFor="cost">Cost per player (£)</label>
      <input id="cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
      <label htmlFor="notes">Notes (optional)</label>
      <textarea id="notes" maxLength={GAME_LIMITS.notesMax} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <p>
        <button type="submit" disabled={busy || !online || !venueId}>
          {editing ? 'Save changes' : 'Post game'}
        </button>
      </p>
      {!online && <p className="muted">You're offline — reconnect to save.</p>}
      {error && <p className="error">{error}</p>}
    </form>
  );
}
