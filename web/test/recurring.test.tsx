import { screen, waitFor, within } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecurringPage } from '../src/pages/Recurring';
import { createFakeApi, type FakeApi } from './fakeApi';
import { renderWithProviders, setMobile } from './render';

let api: FakeApi;
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  setMobile(false);
});
afterEach(() => {
  toast.dismiss();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup(recurring: NonNullable<NonNullable<Parameters<typeof createFakeApi>[0]>['recurring']> = []) {
  api = createFakeApi({ recurring });
  api.install();
  return renderWithProviders(<RecurringPage />, { route: '/recurring' });
}

describe('Recurring page', () => {
  it('starts with an explanation and an Add button when there is nothing yet', async () => {
    setup();
    expect(await screen.findByText('No recurring expenses yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add recurring' })).toBeInTheDocument();
    expect(screen.queryByTestId('recurring-monthly-total')).not.toBeInTheDocument();
  });

  it('adds a yearly bill: previews its monthly share, saves it, and shows it as a twelfth', async () => {
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Add recurring' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a recurring expense' });
    await user.type(within(dialog).getByLabelText('Name'), 'Car insurance');
    await user.type(within(dialog).getByLabelText('Amount'), '12,000');
    await user.click(within(dialog).getByRole('combobox', { name: 'Repeats' }));
    await user.click(await screen.findByRole('option', { name: 'Every year' }));
    expect(within(dialog).getByTestId('per-month-hint')).toHaveTextContent("Counts as ₱1,000.00 in each month's view.");
    await user.click(within(dialog).getByRole('button', { name: 'Add recurring expense' }));

    await waitFor(() => expect(api.callsTo('POST', '/api/recurring')).toHaveLength(1));
    expect(api.callsTo('POST', '/api/recurring')[0]!.body).toMatchObject({ description: 'Car insurance', amount: '12,000', frequency: 'yearly', endDate: null });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const row = (await screen.findByText('Car insurance')).closest('li')!;
    expect(row).toHaveTextContent('₱12,000.00 / year');
    expect(row).toHaveTextContent('counts as ₱1,000.00 a month');
    expect(screen.getByTestId('recurring-monthly-total')).toHaveTextContent('₱1,000.00');
  });

  it('a monthly bill has no "counts as" note, and the monthly total adds up every active item', async () => {
    setup([{ description: 'Netflix', amountCentavos: 54900 }, { description: 'Insurance', amountCentavos: 1200000, frequency: 'yearly' }]);
    const netflix = (await screen.findByText('Netflix')).closest('li')!;
    expect(netflix).toHaveTextContent('₱549.00 / month');
    expect(netflix).not.toHaveTextContent('counts as');
    expect(screen.getByTestId('recurring-monthly-total')).toHaveTextContent('₱1,549.00');
  });

  it('validates before sending, and keeps what you typed', async () => {
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Add recurring' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Amount'), '0');
    await user.click(within(dialog).getByRole('button', { name: 'Add recurring expense' }));
    expect(await within(dialog).findByText('Enter a name, like Netflix or Electricity')).toBeInTheDocument();
    expect(within(dialog).getByText('Amount must be more than zero')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Amount')).toHaveValue('0');
    expect(api.callsTo('POST', '/api/recurring')).toHaveLength(0);

    await user.clear(within(dialog).getByLabelText('Amount'));
    await user.type(within(dialog).getByLabelText('Name'), 'Gym');
    await user.type(within(dialog).getByLabelText('Amount'), '500');
    await user.type(within(dialog).getByLabelText('Last charge (optional)'), '2020-01-01'); // before the first charge
    await user.click(within(dialog).getByRole('button', { name: 'Add recurring expense' }));
    expect(await within(dialog).findByText('The last charge cannot be before the first')).toBeInTheDocument();
    expect(api.callsTo('POST', '/api/recurring')).toHaveLength(0);
  });

  it('shows a server error in the dialog and keeps it open', async () => {
    const { user } = setup();
    api.failNext(/POST \/api\/recurring/, 400, 'category does not exist');
    await user.click(await screen.findByRole('button', { name: 'Add recurring' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'Gym');
    await user.type(within(dialog).getByLabelText('Amount'), '500{Enter}');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('category does not exist');
  });

  it('edits an item, including a last-charge date to end it', async () => {
    const { user } = setup([{ description: 'Netflix', amountCentavos: 54900 }]);
    await user.click(await screen.findByRole('button', { name: 'Edit Netflix' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit Netflix' });
    expect(within(dialog).getByLabelText('Amount')).toHaveValue('549.00');
    await user.clear(within(dialog).getByLabelText('Amount'));
    await user.type(within(dialog).getByLabelText('Amount'), '599');
    await user.type(within(dialog).getByLabelText('Last charge (optional)'), '2026-10-31');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.callsTo('PATCH', '/api/recurring/')).toHaveLength(1));
    expect(api.callsTo('PATCH', '/api/recurring/')[0]!.body).toMatchObject({ amount: '599', endDate: '2026-10-31' });
  });

  it('an ended item is labelled and not counted in the monthly total', async () => {
    setup([{ description: 'Old gym', amountCentavos: 100000, ended: true, endDate: '2026-06-30' }, { description: 'Netflix', amountCentavos: 54900 }]);
    const old = (await screen.findByText('Old gym')).closest('li')!;
    expect(within(old).getByText('Ended')).toBeInTheDocument();
    expect(screen.getByTestId('recurring-monthly-total')).toHaveTextContent('₱549.00');
  });

  it('delete asks first; Keep cancels, Delete removes it', async () => {
    const { user } = setup([{ description: 'Netflix', amountCentavos: 54900 }]);
    await user.click(await screen.findByRole('button', { name: 'Delete Netflix' }));
    await user.click(screen.getByRole('button', { name: 'Keep' }));
    expect(api.callsTo('DELETE', '/api/recurring/')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Delete Netflix' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.callsTo('DELETE', '/api/recurring/')).toHaveLength(1));
    expect(await screen.findByText('No recurring expenses yet.')).toBeInTheDocument();
  });

  it('warns that a charge that is also in an imported statement is counted twice', async () => {
    setup([{ description: 'Netflix', amountCentavos: 54900 }]);
    expect(await screen.findByText(/counted twice/)).toBeInTheDocument();
  });
});
