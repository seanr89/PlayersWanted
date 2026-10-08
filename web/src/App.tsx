import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';

export function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="*" element={<p>PlayersWanted is loading its first screens…</p>} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
