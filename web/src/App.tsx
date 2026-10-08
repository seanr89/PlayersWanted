import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { FinishSignIn } from './auth/FinishSignIn';
import { RequireUser } from './auth/RequireUser';
import { SignIn } from './auth/SignIn';
import { Layout } from './components/Layout';
import { GameDetail } from './screens/GameDetail';
import { GameForm } from './screens/GameForm';
import { GamesList } from './screens/GamesList';

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Layout>
          <Routes>
            <Route path="/" element={<GamesList />} />
            <Route
              path="/games/new"
              element={
                <RequireUser>
                  <GameForm />
                </RequireUser>
              }
            />
            <Route
              path="/games/:gameId/edit"
              element={
                <RequireUser>
                  <GameForm />
                </RequireUser>
              }
            />
            <Route path="/games/:gameId" element={<GameDetail />} />
            <Route path="/sign-in" element={<SignIn />} />
            <Route path="/finish-sign-in" element={<FinishSignIn />} />
            <Route path="*" element={<p>Page not found.</p>} />
          </Routes>
        </Layout>
      </AuthProvider>
    </BrowserRouter>
  );
}
