import { sortWaitlist, type Participant } from '@pw/shared';

interface Props {
  participants: Participant[];
  isOrganiser: boolean;
  busy: boolean;
  onRemove: (uid: string) => void;
  onTogglePaid: (uid: string, paid: boolean) => void;
}

export function Roster({ participants, isOrganiser, busy, onRemove, onTogglePaid }: Props) {
  const confirmed = participants.filter((p) => p.state === 'confirmed').sort((a, b) => a.joinedAt - b.joinedAt);
  const waitlist = sortWaitlist(participants);

  const row = (p: Participant, index: number) => (
    <li key={p.uid} className="row card">
      <span>
        {index + 1}. {p.displayName}
      </span>
      {isOrganiser && (
        <span className="row">
          {p.state === 'confirmed' && (
            <label className="muted" style={{ margin: 0, fontWeight: 400 }}>
              <input type="checkbox" checked={p.paid} disabled={busy} onChange={(e) => onTogglePaid(p.uid, e.target.checked)} /> Paid
            </label>
          )}
          <button className="secondary" disabled={busy} onClick={() => onRemove(p.uid)}>
            Remove
          </button>
        </span>
      )}
    </li>
  );

  return (
    <>
      <h2>Playing ({confirmed.length})</h2>
      {confirmed.length === 0 ? <p className="muted">No one yet.</p> : <ul className="plain">{confirmed.map(row)}</ul>}
      {waitlist.length > 0 && (
        <>
          <h2>Waitlist ({waitlist.length})</h2>
          <ul className="plain">{waitlist.map(row)}</ul>
        </>
      )}
    </>
  );
}
