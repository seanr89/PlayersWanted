import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { useState, type FormEvent } from 'react';
import { AreaSelect } from '../components/AreaSelect';
import { db } from '../firebase';
import { errorMessage } from '../lib/errors';
import { useAreas } from '../lib/hooks';
import { useAuth } from './AuthProvider';

export function Onboarding() {
  const { user } = useAuth();
  const areas = useAreas();
  const [name, setName] = useState(user?.displayName ?? '');
  const [areaId, setAreaId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selectedArea = areaId || areas.data[0]?.id || '';

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    const displayName = name.trim();
    if (displayName.length < 2 || displayName.length > 30) {
      setError('Your name must be 2–30 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await setDoc(doc(db, 'users', user.uid), {
        displayName,
        email: user.email,
        photoURL: user.photoURL ?? null,
        homeAreaId: selectedArea,
        notify: { email: true, push: false },
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save}>
      <h1>Welcome to PlayersWanted</h1>
      <label htmlFor="name">Your name (shown to other players)</label>
      <input id="name" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
      <label htmlFor="area">Home area</label>
      <AreaSelect id="area" value={selectedArea} areas={areas.data} onChange={setAreaId} />
      <p>
        <button type="submit" disabled={busy || !selectedArea}>
          Continue
        </button>
      </p>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
