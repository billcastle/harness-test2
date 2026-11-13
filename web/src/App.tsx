import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { PinScreen } from './auth/PinScreen';
import { AddExpenseButton } from './components/AddExpenseButton';
import { api, SESSION_EXPIRED } from './lib/api';
import { CategoriesPage } from './pages/Categories';
import { DashboardPage } from './pages/Dashboard';
import { ImportPage } from './pages/Import';
import { TransactionsPage } from './pages/Transactions';

type Auth = 'checking' | 'signed-in' | 'signed-out';

export function App() {
  const qc = useQueryClient();
  const [params] = useSearchParams();
  // the date range is shared by Dashboard and Transactions, so moving between them keeps it
  const rangeSearch = params.get('from') && params.get('to') ? `?from=${params.get('from')}&to=${params.get('to')}` : '';
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
      <header className="mb-10 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Expenses</h1>
          <p className="text-muted-foreground">Add, review and edit what you spend.</p>
        </div>
        <div className="flex items-center gap-3">
          <AddExpenseButton />
          <Button type="button" variant="outline" size="lg" onClick={() => void logout()}>Sign out</Button>
        </div>
      </header>
      <nav aria-label="Main" className="mb-10 flex gap-3">
        {[{ to: '/dashboard', label: 'Dashboard', range: true }, { to: '/transactions', label: 'Transactions', range: true }, { to: '/import', label: 'Import', range: false }, { to: '/categories', label: 'Categories', range: false }].map(({ to, label, range }) => (
          <NavLink key={to} to={{ pathname: to, search: range ? rangeSearch : '' }} className={({ isActive }) => `inline-flex h-11 items-center rounded-full px-6 text-base font-medium transition-colors ${isActive ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground hover:bg-muted/70'}`}>
            {label}
          </NavLink>
        ))}
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/categories" element={<CategoriesPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
    </div>
  );
}
