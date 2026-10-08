import { formatKickoff, formatPence, spacesLabel, type Game } from '@pw/shared';
import { Link } from 'react-router-dom';

export function GameCard({ game }: { game: Game }) {
  return (
    <Link to={`/games/${game.id}`} className="card">
      <div className="row">
        <strong>{formatKickoff(game.startsAt)}</strong>
        <span className="pill">{game.status === 'cancelled' ? 'Cancelled' : spacesLabel(game)}</span>
      </div>
      <div>{game.venue.name}</div>
      <div className="muted">
        {game.format} · {game.durationMins} mins · {formatPence(game.costPerPlayerPence)}
      </div>
    </Link>
  );
}
