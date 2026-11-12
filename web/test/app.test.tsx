import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('session gate', () => {
  it('shows the PIN screen when signed out, then the app after the PIN', async () => {
    api = createFakeApi({ signedIn: false, transactions: [{ description: 'Lunch', date: `${month}-02` }] });
    api.install();
    const { user } = renderWithProviders(<App />);
    expect(await screen.findByText('Enter your PIN')).toBeInTheDocument();
    expect(screen.queryByText('Lunch')).not.toBeInTheDocument(); // nothing leaks before sign-in
    await user.type(screen.getByLabelText('PIN, 4 digits'), '4821');
    expect(await screen.findByText('Lunch')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('skips the PIN screen when a session already exists', async () => {
    api = createFakeApi({ signedIn: true, transactions: [{ description: 'Lunch', date: `${month}-02` }] });
    api.install();
    renderWithProviders(<App />);
    expect(await screen.findByText('Lunch')).toBeInTheDocument();
    expect(screen.queryByText('Enter your PIN')).not.toBeInTheDocument();
  });

  it('sign out returns to the PIN screen and drops cached data', async () => {
    api = createFakeApi({ signedIn: true, transactions: [{ description: 'Lunch', date: `${month}-02` }] });
    api.install();
    const { user, client } = renderWithProviders(<App />);
    await screen.findByText('Lunch');
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText('Enter your PIN')).toBeInTheDocument();
    expect(api.callsTo('POST', '/api/logout')).toHaveLength(1);
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });

  it('an expired session mid-use returns to the PIN screen, and signing back in resumes', async () => {
    api = createFakeApi({ signedIn: true, transactions: [{ description: 'Lunch', date: `${month}-02` }] });
    api.install();
    const { user } = renderWithProviders(<App />);
    await screen.findByText('Lunch');

    api.state.signedIn = false; // the server forgets the session (expired or reset-pin)
    await user.type(screen.getByLabelText('Amount'), '5{Enter}');
    expect(await screen.findByText('Enter your PIN')).toBeInTheDocument();

    await user.type(screen.getByLabelText('PIN, 4 digits'), '4821');
    await waitFor(() => expect(screen.getByText('Lunch')).toBeInTheDocument());
  });
});
