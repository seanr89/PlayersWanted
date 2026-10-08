import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { FinishSignIn } from './auth/FinishSignIn';
import { SignIn } from './auth/SignIn';
import { Layout } from './components/Layout';

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Layout>
          <Routes>
            <Route path="/sign-in" element={<SignIn />} />
            <Route path="/finish-sign-in" element={<FinishSignIn />} />
            <Route path="*" element={<p>Games list arrives in the next task.</p>} />
          </Routes>
        </Layout>
      </AuthProvider>
    </BrowserRouter>
  );
}
