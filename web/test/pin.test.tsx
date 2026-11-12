import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PinScreen } from '../src/auth/PinScreen';
import { createFakeApi, type FakeApi } from './fakeApi';
import { renderWithProviders } from './render';

let api: FakeApi;
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  api = createFakeApi({ signedIn: false });
  api.install();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const pinInput = () => screen.getByLabelText('PIN, 4 digits');

describe('PIN screen', () => {
  it('auto-submits on the fourth digit and signs in', async () => {
    const onSuccess = vi.fn();
    const { user } = renderWithProviders(<PinScreen onSuccess={onSuccess} />);
    await user.type(pinInput(), '482');
    expect(api.callsTo('POST', '/api/login')).toHaveLength(0); // not yet
    await user.type(pinInput(), '1');
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(api.callsTo('POST', '/api/login')[0]!.body).toEqual({ pin: '4821' });
  });

  it('is a numeric field that masks digits as dots and ignores non-digits', async () => {
    const { user, container } = renderWithProviders(<PinScreen onSuccess={() => undefined} />);
    expect(pinInput()).toHaveAttribute('inputmode', 'numeric');
    await user.type(pinInput(), 'a1b2');
    const slots = Array.from(container.querySelectorAll('[data-slot=input-otp-slot]')).map((s) => s.textContent);
    expect(slots).toEqual(['•', '•', '', '']); // two digits typed, shown as dots, never as digits
    expect(container.textContent).not.toContain('12');
  });

  it('accepts a pasted PIN', async () => {
    const onSuccess = vi.fn();
    const { user } = renderWithProviders(<PinScreen onSuccess={onSuccess} />);
    await user.click(pinInput());
    await user.paste('4821');
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  it('shows a text error (not color only) for a wrong PIN, clears the field and keeps focus', async () => {
    const onSuccess = vi.fn();
    const { user } = renderWithProviders(<PinScreen onSuccess={onSuccess} />);
    await user.type(pinInput(), '0000');
    expect(await screen.findByText('Wrong PIN. Try again.')).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(pinInput()).toHaveValue('');
    expect(pinInput()).toHaveFocus();
    expect(pinInput()).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows a lockout countdown ("Try again in 1:00"), disables the field, then re-enables it', async () => {
    api.failNext(/POST \/api\/login/, 401, 'wrong PIN', { retryAfterSeconds: 60 });
    const { user } = renderWithProviders(<PinScreen onSuccess={() => undefined} />);
    await user.type(pinInput(), '0000');
    expect(await screen.findByText(/Try again in/)).toHaveTextContent('Try again in 1:00');
    expect(pinInput()).toBeDisabled();

    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.getByText(/Try again in/)).toHaveTextContent('Try again in 0:55');

    await act(async () => { await vi.advanceTimersByTimeAsync(56_000); });
    await waitFor(() => expect(pinInput()).not.toBeDisabled());
    expect(screen.queryByText(/Try again in/)).not.toBeInTheDocument();
  });

  it('a blocked IP (429 with a countdown) shows the countdown', async () => {
    api.failNext(/POST \/api\/login/, 429, 'too many wrong attempts', { retryAfterSeconds: 272 });
    const { user } = renderWithProviders(<PinScreen onSuccess={() => undefined} />);
    await user.type(pinInput(), '4821');
    expect(await screen.findByText(/Try again in/)).toHaveTextContent('Try again in 4:32');
  });

  it('the global cap shows a generic message with no countdown', async () => {
    api.failNext(/POST \/api\/login/, 429, 'try again later');
    const { user } = renderWithProviders(<PinScreen onSuccess={() => undefined} />);
    await user.type(pinInput(), '4821');
    expect(await screen.findByText('Too many attempts. Please try again later.')).toBeInTheDocument();
    expect(screen.queryByText(/Try again in/)).not.toBeInTheDocument();
    expect(pinInput()).not.toBeDisabled();
  });

  it('a network failure shows a connection message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')));
    const { user } = renderWithProviders(<PinScreen onSuccess={() => undefined} />);
    await user.type(pinInput(), '4821');
    expect(await screen.findByText(/Check your connection/)).toBeInTheDocument();
  });
});
