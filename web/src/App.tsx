import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { PinScreen } from './auth/PinScreen';
import { api, SESSION_EXPIRED } from './lib/api';
import { TransactionsPage } from './pages/Transactions';

type Auth = 'checking' | 'signed-in' | 'signed-out';

export function App() {
  const qc = useQueryClient();
  const [auth, setAuth] = useState<Auth>('checking');

  useEffect(() => {
    // Any 401 (an expired session) returns to the PIN screen. The query cache is kept, so signing back in resumes where you were.
    const expired = () => setAuth('signed-out');
    window.addEventListener(SESSION_EXPIRED, expired);
    api.session().then(() => setAuth('signed-in')).catch(() => setAuth('signed-out'));
    return () => window.removeEventListener(SESSION_EXPIRED, expired);
  }, []);

  if (auth === 'checking') return <p className="p-8 text-muted-foreground" aria-busy="true">Loading…</p>;
  if (auth === 'signed-out') {
    return <PinScreen onSuccess={() => { void qc.invalidateQueries(); setAuth('signed-in'); }} />;
  }

  async function logout() {
    await api.logout().catch(() => undefined);
    qc.clear();
    setAuth('signed-out');
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-6 pt-8 pb-32">
      <header className="mb-10 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Expenses</h1>
          <p className="text-muted-foreground">Add, review and edit what you spend.</p>
        </div>
        <Button type="button" variant="outline" onClick={() => void logout()}>Sign out</Button>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/transactions" replace />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="*" element={<Navigate to="/transactions" replace />} />
        </Routes>
      </main>
    </div>
  );
}
