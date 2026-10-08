import { signOut } from 'firebase/auth';
import { doc, updateDoc } from 'firebase/firestore';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { AreaSelect } from '../components/AreaSelect';
import { auth, db } from '../firebase';
import { errorMessage } from '../lib/errors';
import { useAreas } from '../lib/hooks';
import { currentPermission, disablePush, enablePush, isStandalone } from '../push';

export function Profile() {
  const { user, profile } = useAuth();
  const areas = useAreas();
  const navigate = useNavigate();
  const [name, setName] = useState(profile?.displayName ?? '');
  const [areaId, setAreaId] = useState(profile?.homeAreaId ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!user || !profile) return null;
  const uid = user.uid;

  async function run(fn: () => Promise<unknown>, success: string) {
    setError(null);
    setMessage(null);
    try {
      await fn();
      setMessage(success);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function saveDetails(e: FormEvent) {
    e.preventDefault();
    const displayName = name.trim();
    if (displayName.length < 2 || displayName.length > 30) return setError('Your name must be 2–30 characters.');
    void run(() => updateDoc(doc(db, 'users', uid), { displayName, homeAreaId: areaId }), 'Saved.');
  }

  async function togglePush(on: boolean) {
    if (!on) return run(() => disablePush(uid), 'Push notifications off.');
    const outcome = await enablePush(uid).catch((err) => {
      setError(errorMessage(err));
      return null;
    });
    if (outcome === 'enabled') setMessage('Push notifications on.');
    if (outcome === 'denied') setError('Notifications are blocked. Allow them in your browser settings, then try again.');
    if (outcome === 'unsupported') setError('This browser does not support push notifications.');
  }

  const iosNeedsInstall = /iPhone|iPad/.test(navigator.userAgent) && !isStandalone();

  return (
    <section>
      <h1>Profile</h1>
      <form onSubmit={saveDetails}>
        <label htmlFor="name">Display name</label>
        <input id="name" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
        <label htmlFor="area">Home area</label>
        <AreaSelect id="area" value={areaId} areas={areas.data} onChange={setAreaId} />
        <p>
          <button type="submit">Save</button>
        </p>
      </form>

      <h2>Notifications</h2>
      <label>
        <input
          type="checkbox"
          checked={profile.notify.email}
          onChange={(e) =>
            void run(() => updateDoc(doc(db, 'users', uid), { 'notify.email': e.target.checked }), 'Saved.')
          }
        />{' '}
        Email ({profile.email})
      </label>
      <label>
        <input type="checkbox" checked={profile.notify.push} onChange={(e) => void togglePush(e.target.checked)} /> Push
        notifications on this device
      </label>
      {iosNeedsInstall && (
        <p className="muted">On iPhone, add PlayersWanted to your Home Screen (Share → Add to Home Screen) to get push notifications.</p>
      )}
      {currentPermission() === 'denied' && <p className="muted">Notifications are blocked in this browser's settings.</p>}

      {message && <p role="status">{message}</p>}
      {error && <p className="error">{error}</p>}

      <h2>Account</h2>
      <button className="secondary" onClick={() => void signOut(auth).then(() => navigate('/'))}>
        Sign out
      </button>
    </section>
  );
}
