import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useOnline } from '../lib/useOnline';

export function Layout({ children }: { children: ReactNode }) {
  const online = useOnline();
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          PlayersWanted
        </Link>
      </header>
      {!online && (
        <div className="offline" role="status">
          You're offline. Showing the games you last saw.
        </div>
      )}
      <main>{children}</main>
    </div>
  );
}
