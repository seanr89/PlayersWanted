import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Onboarding } from '../auth/Onboarding';
import { useOnline } from '../lib/useOnline';

const AUTH_PATHS = ['/sign-in', '/finish-sign-in'];

export function Layout({ children }: { children: ReactNode }) {
  const online = useOnline();
  const { user, profile, loading } = useAuth();
  const location = useLocation();
  const needsOnboarding = !loading && user !== null && profile === null && !AUTH_PATHS.includes(location.pathname);
  const next = encodeURIComponent(location.pathname + location.search);

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          PlayersWanted
        </Link>
        <nav>
          {user ? (
            <>
              <Link to="/my-games">My games</Link>
              <Link to="/profile">Profile</Link>
            </>
          ) : (
            <Link to={`/sign-in?next=${next}`}>Sign in</Link>
          )}
        </nav>
      </header>
      {!online && (
        <div className="offline" role="status">
          You're offline. Showing the games you last saw.
        </div>
      )}
      <main>{needsOnboarding ? <Onboarding /> : children}</main>
    </div>
  );
}
