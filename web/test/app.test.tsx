import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { App } from '../src/App';
import { manilaToday } from '../src/lib/dates';
import { createFakeApi, type FakeApi } from './fakeApi';
import { renderWithProviders, setMobile } from './render';

let api: FakeApi;
const month = manilaToday().slice(0, 7);

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localStorage.clear();
  setMobile(false);
});
afterEach(() => {
  toast.dismiss(); // toasts are global and would otherwise leak into the next test
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('session gate', () => {
  it('shows the PIN screen when signed out, then the app after the PIN', async () => {
    api = createFakeApi({ signedIn: false, transactions: [{ description: 'Lunch', date: `${month}-02` }] });
    api.install();
    const { user } = renderWithProviders(<App />);
    expect(await screen.findByText('Enter your PIN')).toBeInTheDocument();
    expect(screen.queryAllByText('Lunch')).toHaveLength(0); // nothing leaks before sign-in
    await user.type(screen.getByLabelText('PIN, 4 digits'), '4821');
    expect((await screen.findAllByText('Lunch')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('skips the PIN screen when a session already exists', async () => {
    api = createFakeApi({ signedIn: true, transactions: [{ description: 'Lunch', date: `${month}-02` }] });
    api.install();
    renderWithProviders(<App />);
    expect((await screen.findAllByText('Lunch')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Enter your PIN')).not.toBeInTheDocument();
  });

  it('sign out returns to the PIN screen and drops cached data', async () => {
    api = createFakeApi({ signedIn: true, transactions: [{ description: 'Lunch', date: `${month}-02` }] });
    api.install();
    const { user, client } = renderWithProviders(<App />);
    await screen.findAllByText('Lunch');
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText('Enter your PIN')).toBeInTheDocument();
    expect(api.callsTo('POST', '/api/logout')).toHaveLength(1);
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });

  it('an expired session mid-use returns to the PIN screen, and signing back in resumes', async () => {
    api = createFakeApi({ signedIn: true, transactions: [{ description: 'Lunch', date: `${month}-02` }] });
    api.install();
    const { user } = renderWithProviders(<App />);
    await screen.findAllByText('Lunch');

    api.state.signedIn = false; // the server forgets the session (expired or reset-pin)
    await user.type(screen.getByLabelText('Amount'), '5{Enter}');
    expect(await screen.findByText('Enter your PIN')).toBeInTheDocument();

    await user.type(screen.getByLabelText('PIN, 4 digits'), '4821');
    await waitFor(() => expect(screen.getAllByText('Lunch').length).toBeGreaterThan(0));
  });
});

describe('navigation', () => {
  it('Dashboard and Transactions are one tab: the Overview shows the summary and the list, and the range moves to Import only as a dropped filter', async () => {
    api = createFakeApi({ signedIn: true, transactions: [{ description: 'Lunch', date: '2026-03-02' }] });
    api.install();
    const { user } = renderWithProviders(<App />, { route: '/?from=2026-03-01&to=2026-03-31' });
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getAllByRole('link').map((l) => l.textContent)).toEqual(['Overview', 'Recurring', 'Import', 'Categories']);
    expect(within(nav).getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByTestId('net-total')).toBeInTheDocument(); // the dashboard part
    expect(await screen.findByRole('heading', { name: 'Transactions' })).toBeInTheDocument(); // and the list, on the same page
    expect(screen.getAllByText('Lunch').length).toBeGreaterThan(0);
    await user.click(within(nav).getByRole('link', { name: 'Import' }));
    await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent(/^\/import$/));
    await user.click(within(nav).getByRole('link', { name: 'Categories' }));
    await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent(/^\/categories$/));
  });

  it.each(['/dashboard', '/transactions'])('the old %s link lands on the Overview and keeps its filters', async (old) => {
    api = createFakeApi({ signedIn: true });
    api.install();
    renderWithProviders(<App />, { route: `${old}?from=2026-03-01&to=2026-03-31&category=1` });
    await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent('/?from=2026-03-01&to=2026-03-31&category=1'));
  });

  it('opens on the Overview', async () => {
    api = createFakeApi({ signedIn: true });
    api.install();
    renderWithProviders(<App />, { route: '/' });
    expect(await screen.findByRole('heading', { name: 'Transactions' })).toBeInTheDocument();
    expect(screen.getByTestId('url')).toHaveTextContent(/^\/$/);
  });

  it('right after an import it shows only that import, without the dashboard', async () => {
    api = createFakeApi({ signedIn: true, transactions: [{ description: 'Imported one', date: '2026-01-05' }] });
    api.install();
    renderWithProviders(<App />, { route: '/?batch=abc' });
    expect(await screen.findByText(/Showing the transactions from that import/)).toBeInTheDocument();
    expect(screen.queryByTestId('net-total')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Date range' })).not.toBeInTheDocument();
  });
});

describe('Add expense button', () => {
  it.each([['/', false], ['/categories', false], ['/import', false], ['/', true]])(
    'is in the header on %s (phone: %s) and adds an expense from there',
    async (route, phone) => {
      setMobile(phone);
      api = createFakeApi({ signedIn: true });
      api.install();
      const { user } = renderWithProviders(<App />, { route });
      const header = (await screen.findByRole('banner')) as HTMLElement;
      await user.click(within(header).getByRole('button', { name: 'Add expense' }));
      const dialog = await screen.findByRole('dialog', { name: 'Add an expense' });
      await user.type(within(dialog).getByLabelText('Amount'), '45.50');
      await user.type(within(dialog).getByLabelText('Description'), 'Coffee{Enter}');
      await waitFor(() => expect(api.callsTo('POST', '/api/transactions')).toHaveLength(1));
      expect(api.callsTo('POST', '/api/transactions')[0]!.body).toMatchObject({ amount: '45.50', description: 'Coffee' });
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add an expense' })).not.toBeInTheDocument());
      expect(await screen.findByText(/Added ₱45\.50 · Coffee/)).toBeInTheDocument();
      expect(screen.getByTestId('url')).toHaveTextContent(route); // adding never navigates away
    },
  );

  it('a validation error keeps the dialog open so nothing typed is lost', async () => {
    api = createFakeApi({ signedIn: true });
    api.install();
    const { user } = renderWithProviders(<App />, { route: '/' });
    await user.click(await screen.findByRole('button', { name: 'Add expense' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add an expense' });
    await user.type(within(dialog).getByLabelText('Description'), 'Oops{Enter}');
    expect(await within(dialog).findByText('Enter an amount')).toBeInTheDocument();
    expect(api.callsTo('POST', '/api/transactions')).toHaveLength(0);
  });

  it('updates the dashboard total after adding', async () => {
    api = createFakeApi({ signedIn: true });
    api.install();
    const { user } = renderWithProviders(<App />, { route: '/' });
    expect(await screen.findByText(/No expenses in/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add expense' }));
    await user.type(within(await screen.findByRole('dialog')).getByLabelText('Amount'), '100{Enter}');
    expect(await screen.findByTestId('net-total')).toHaveTextContent('₱100.00');
  });
});
