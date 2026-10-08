import { venueFromData } from '@pw/shared';
import { addDoc, collection, orderBy, query, serverTimestamp, where } from 'firebase/firestore';
import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { db } from '../firebase';
import { errorMessage } from '../lib/errors';
import { useLiveQuery } from '../lib/hooks';

interface Props {
  areaId: string;
  value: string;
  onChange: (venueId: string) => void;
}

export function VenuePicker({ areaId, value, onChange }: Props) {
  const { user } = useAuth();
  const venues = useLiveQuery(
    () => query(collection(db, 'venues'), where('areaId', '==', areaId), orderBy('name')),
    (d) => venueFromData(d.id, d.data()),
    [areaId],
  );
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [mapsUrl, setMapsUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function addVenue() {
    if (!user) return;
    setError(null);
    try {
      const ref = await addDoc(collection(db, 'venues'), {
        name: name.trim(),
        address: address.trim(),
        areaId,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        ...(mapsUrl.trim() ? { mapsUrl: mapsUrl.trim() } : {}),
      });
      onChange(ref.id);
      setAdding(false);
      setName('');
      setAddress('');
      setMapsUrl('');
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div>
      <label htmlFor="venue">Venue</label>
      <select id="venue" value={value} onChange={(e) => onChange(e.target.value)} required>
        <option value="">Choose a venue…</option>
        {venues.data.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name} — {v.address}
          </option>
        ))}
      </select>
      {!adding ? (
        <button type="button" className="secondary" style={{ marginTop: 8 }} onClick={() => setAdding(true)}>
          Add a venue
        </button>
      ) : (
        <div className="card" style={{ marginTop: 8 }}>
          <label htmlFor="venue-name">Venue name</label>
          <input id="venue-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          <label htmlFor="venue-address">Address</label>
          <input id="venue-address" value={address} maxLength={120} onChange={(e) => setAddress(e.target.value)} />
          <label htmlFor="venue-maps">Map link (optional, https://…)</label>
          <input id="venue-maps" value={mapsUrl} onChange={(e) => setMapsUrl(e.target.value)} />
          <div className="row" style={{ marginTop: 8 }}>
            <button type="button" onClick={addVenue} disabled={name.trim().length < 2 || address.trim().length < 2}>
              Save venue
            </button>
            <button type="button" className="secondary" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
          {error && <p className="error">{error}</p>}
        </div>
      )}
    </div>
  );
}
