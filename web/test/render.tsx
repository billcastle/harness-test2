import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import { Toaster } from '../src/components/ui/sonner';

function Probe() {
  const l = useLocation();
  return <div data-testid="url">{l.pathname + l.search}</div>;
}

export function renderWithProviders(ui: ReactElement, opts: { route?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
  const utils = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[opts.route ?? '/transactions']}>
        {ui}
        <Probe />
        <Toaster />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, user, client };
}

/** Pretend the viewport is (or is not) below 640px. */
export function setMobile(isMobile: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: isMobile && q.includes('max-width: 639px'),
    media: q, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined,
    addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

import type { UserEvent } from '@testing-library/user-event';
import { screen } from '@testing-library/react';

/** Radix selects are not native <select>s: open the trigger, then click the option. */
export async function choose(user: UserEvent, trigger: HTMLElement, optionName: string | RegExp) {
  await user.click(trigger);
  await user.click(await screen.findByRole('option', { name: optionName }));
}
