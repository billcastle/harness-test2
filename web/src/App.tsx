import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { PinScreen } from './auth/PinScreen';
import { AddExpenseButton } from './components/AddExpenseButton';
import { api, SESSION_EXPIRED } from './lib/api';
import { CategoriesPage } from './pages/Categories';
import { ImportPage } from './pages/Import';
import { OverviewPage } from './pages/Overview';
import { RecurringPage } from './pages/Recurring';

type Auth = 'checking' | 'signed-in' | 'signed-out';

export function App() {
  const qc = useQueryClient();
  const [params] = useSearchParams();
  // the Overview keeps its date range in the URL; the nav link back to it carries the range along
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
    <div className="mx-auto w-full max-w-6xl px-4 pt-6 pb-24 sm:px-6 sm:pt-8 sm:pb-32">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 sm:mb-10">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Expenses</h1>
          <p className="text-muted-foreground">Add, review and edit what you spend.</p>
        </div>
        <div className="flex items-center gap-3">
          <AddExpenseButton />
          <Button type="button" variant="outline" size="lg" onClick={() => void logout()}>Sign out</Button>
        </div>
      </header>
      <nav aria-label="Main" className="mb-6 flex flex-wrap gap-2 sm:mb-10 sm:gap-3">
        {[{ to: '/', label: 'Overview', range: true }, { to: '/recurring', label: 'Recurring', range: false }, { to: '/import', label: 'Import', range: false }, { to: '/categories', label: 'Categories', range: false }].map(({ to, label, range }) => (
          <NavLink key={to} to={{ pathname: to, search: range ? rangeSearch : '' }} end={to === '/'} className={({ isActive }) => `inline-flex h-10 items-center rounded-full px-3 text-sm font-medium sm:h-11 sm:px-6 sm:text-base transition-colors ${isActive ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground hover:bg-muted/70'}`}>
            {label}
          </NavLink>
        ))}
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          {/* the old Dashboard and Transactions tabs are one page now; old links and bookmarks keep their filters */}
          <Route path="/dashboard" element={<ToOverview />} />
          <Route path="/transactions" element={<ToOverview />} />
          <Route path="/recurring" element={<RecurringPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/categories" element={<CategoriesPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function ToOverview() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: '/', search }} replace />;
}
