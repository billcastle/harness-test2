import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transaction } from '../src/lib/api';
import { manilaToday, monthRange } from '../src/lib/dates';
import { TransactionsPage } from '../src/pages/Transactions';
import { createFakeApi, type FakeApi } from './fakeApi';
import { toast } from 'sonner';
import { choose, renderWithProviders, setMobile } from './render';

// Sonner owns the toast timer (and pauses it on hover); we assert what our code asks for: a 5-second toast with an Undo action.
vi.mock('sonner', async (original) => {
  const actual = await original<typeof import('sonner')>();
  return { ...actual, toast: Object.assign(vi.fn(actual.toast), actual.toast) }; // keep toast.dismiss etc.
});

const today = manilaToday();
const month = today.slice(0, 7);
const range = monthRange(today);
let api: FakeApi;

function setup(transactions: Partial<Transaction>[] = [], route?: string) {
  api = createFakeApi({ transactions });
  api.install();
  return renderWithProviders(<TransactionsPage />, { route });
}
const rowOf = (text: string) => screen.getByText(text).closest('tr') as HTMLElement;
const url = () => screen.getByTestId('url').textContent ?? '';

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localStorage.clear();
  setMobile(false);
});
afterEach(() => {
  toast.dismiss(); // Sonner keeps its toasts in a module-level store; clear it between tests
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('loading and states', () => {
  it('asks for this month in Asia/Manila by default and shows skeletons while loading', async () => {
    api = createFakeApi({ transactions: [{ description: 'Lunch', date: `${month}-02` }] });
    api.state.delayMs = 200;
    api.install();
    renderWithProviders(<TransactionsPage />);
    expect(screen.getByLabelText('Loading transactions')).toBeInTheDocument();
    expect(await screen.findByText('Lunch')).toBeInTheDocument();
    const req = api.callsTo('GET', '/api/transactions')[0]!.url;
    expect(req).toContain(`from=${range.from}`);
    expect(req).toContain(`to=${range.to}`);
  });

  it('shows an empty state for a range with no transactions', async () => {
    setup([]);
    expect(await screen.findByText('No transactions in this range.')).toBeInTheDocument();
  });

  it('search that matches nothing shows a filter-specific empty state, and Clear filters resets it', async () => {
    const { user } = setup([{ description: 'Lunch', date: `${month}-02` }]);
    await screen.findByText('Lunch');
    await user.type(screen.getByLabelText('Search description'), 'zzz');
    expect(await screen.findByText('No transactions match these filters.')).toBeInTheDocument();
    expect(url()).toContain('q=zzz');
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByText('Lunch')).toBeInTheDocument();
    expect(url()).not.toContain('q=');
  });

  it('shows an error banner with Retry when loading fails', async () => {
    api = createFakeApi({ transactions: [{ description: 'Lunch', date: `${month}-02` }] });
    api.install();
    api.failAlways(/GET \/api\/transactions/, 500, 'internal error');
    const { user } = renderWithProviders(<TransactionsPage />);
    expect(await screen.findByText('Could not load transactions.')).toBeInTheDocument();
    api.clearFailures();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Lunch')).toBeInTheDocument();
  });
});

describe('quick add', () => {
  it('keyboard-friendly: Amount, then the Category select, then Description, Enter saves, clears Amount and refocuses it', async () => {
    const { user } = setup([]);
    await screen.findByText('No transactions in this range.');
    const amount = screen.getByLabelText('Amount');
    expect(amount).toHaveFocus(); // the form is ready to type into
    await user.type(amount, '250.50');
    await user.tab();
    const category = screen.getByRole('combobox', { name: 'Category' });
    expect(category).toHaveFocus();
    await choose(user, category, 'Food');
    await user.tab();
    expect(screen.getByLabelText('Description')).toHaveFocus();
    await user.type(screen.getByLabelText('Description'), 'Jollibee{Enter}');

    await waitFor(() => expect(api.callsTo('POST', '/api/transactions')).toHaveLength(1));
    expect(api.callsTo('POST', '/api/transactions')[0]!.body).toEqual({ amount: '250.50', date: today, description: 'Jollibee', categoryId: 2 });
    expect(await screen.findByText('Jollibee')).toBeInTheDocument();
    expect(within(rowOf('Jollibee')).getByText('₱250.50')).toBeInTheDocument();
    expect(rowOf('Jollibee')).toHaveClass('flash'); // new row is highlighted briefly
    expect(screen.getByLabelText('Amount')).toHaveValue('');
    expect(screen.getByLabelText('Amount')).toHaveFocus();
    expect(screen.getByLabelText('Description')).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Category' })).toHaveTextContent('Food'); // kept for the next entry
  });

  it('category is a real select listing every category, with Uncategorized as the default', async () => {
    const { user } = setup([]);
    await screen.findByText('No transactions in this range.');
    const category = screen.getByRole('combobox', { name: 'Category' });
    await waitFor(() => expect(category).toHaveTextContent('Uncategorized'));
    await user.click(category);
    const names = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(names).toEqual(['Uncategorized', 'Food', 'Transport']);
  });

  it('defaults the date to today in Manila and the category to Uncategorized', async () => {
    const { user } = setup([]);
    await screen.findByText('No transactions in this range.');
    expect(screen.getByLabelText('Date')).toHaveValue(today);
    await user.type(screen.getByLabelText('Amount'), '5{Enter}');
    await waitFor(() => expect(api.callsTo('POST', '/api/transactions')).toHaveLength(1));
    expect(api.callsTo('POST', '/api/transactions')[0]!.body).toMatchObject({ categoryId: 1 }); // Uncategorized
    expect(await within(await screen.findByRole('table')).findByText('Uncategorized')).toBeInTheDocument();
  });

  it('remembers the last used category next time', async () => {
    const first = setup([]);
    await screen.findByText('No transactions in this range.');
    await first.user.type(screen.getByLabelText('Amount'), '5');
    await choose(first.user, screen.getByRole('combobox', { name: 'Category' }), 'Transport');
    await first.user.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(api.callsTo('POST', '/api/transactions')).toHaveLength(1));
    first.unmount();
    renderWithProviders(<TransactionsPage />);
    // appears once the categories have loaded
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Category' })).toHaveTextContent('Transport'));
  });

  it('blocks bad input before sending anything, with a message next to the field', async () => {
    const { user } = setup([]);
    await screen.findByText('No transactions in this range.');
    await user.type(screen.getByLabelText('Amount'), '{Enter}');
    expect(screen.getByText('Enter an amount')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Amount'), '250.555{Enter}');
    expect(screen.getByText('Use numbers like 250 or 1,250.50')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '' } });
    await user.clear(screen.getByLabelText('Amount'));
    await user.type(screen.getByLabelText('Amount'), '5{Enter}');
    expect(screen.getByText('Enter a real date')).toBeInTheDocument();
    expect(api.callsTo('POST', '/api/transactions')).toHaveLength(0);
  });

  it('shows a server error and keeps what was typed', async () => {
    const { user } = setup([]);
    await screen.findByText('No transactions in this range.');
    api.failNext(/POST \/api\/transactions/, 400, 'amount is too large');
    await user.type(screen.getByLabelText('Amount'), '5{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('amount is too large');
    expect(screen.getByLabelText('Amount')).toHaveValue('5');
  });

  it('adding outside the viewed range tells you where it went instead of silently vanishing', async () => {
    const { user } = setup([]);
    await screen.findByText('No transactions in this range.');
    await user.type(screen.getByLabelText('Amount'), '5');
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2020-01-05' } });
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText(/outside the date range you are viewing/)).toBeInTheDocument();
  });
});

describe('inline edit', () => {
  const seed = [{ description: 'Lunch', date: `${month}-02`, amountCentavos: 15000 }];

  it('click the amount, type, Enter: saves in place', async () => {
    const { user } = setup(seed);
    await screen.findByText('Lunch');
    await user.click(within(rowOf('Lunch')).getByRole('button', { name: 'Edit Amount' }));
    const input = screen.getByLabelText('Amount', { selector: '.cell-editor' });
    expect(input).toHaveFocus();
    await user.clear(input);
    await user.type(input, '99.5{Enter}');
    await waitFor(() => expect(api.callsTo('PATCH', '/api/transactions/')).toHaveLength(1));
    expect(api.callsTo('PATCH', '/api/transactions/')[0]!.body).toEqual({ amount: '99.5' });
    expect(await within(rowOf('Lunch')).findByText('₱99.50')).toBeInTheDocument();
  });

  it('Enter on a focused cell button also opens the editor (keyboard only)', async () => {
    const { user } = setup(seed);
    await screen.findByText('Lunch');
    within(rowOf('Lunch')).getByRole('button', { name: 'Edit Description' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('Description', { selector: '.cell-editor' })).toHaveFocus();
  });

  it('Esc cancels without saving', async () => {
    const { user } = setup(seed);
    await screen.findByText('Lunch');
    await user.click(within(rowOf('Lunch')).getByRole('button', { name: 'Edit Amount' }));
    await user.type(screen.getByLabelText('Amount', { selector: '.cell-editor' }), '9{Escape}');
    expect(api.callsTo('PATCH', '/api/transactions/')).toHaveLength(0);
    expect(within(rowOf('Lunch')).getByText('₱150.00')).toBeInTheDocument();
  });

  it('leaving the field saves a changed value, and an unchanged one sends nothing', async () => {
    const { user } = setup(seed);
    await screen.findByText('Lunch');
    await user.click(within(rowOf('Lunch')).getByRole('button', { name: 'Edit Description' }));
    await user.tab(); // blur without changing
    expect(api.callsTo('PATCH', '/api/transactions/')).toHaveLength(0);
    await user.click(within(rowOf('Lunch')).getByRole('button', { name: 'Edit Description' }));
    await user.type(screen.getByLabelText('Description', { selector: '.cell-editor' }), ' with team');
    await user.tab();
    await waitFor(() => expect(api.callsTo('PATCH', '/api/transactions/')).toHaveLength(1));
    expect(api.callsTo('PATCH', '/api/transactions/')[0]!.body).toEqual({ description: 'Lunch with team' });
  });

  it('a failed save reverts the cell to its old value and shows the error', async () => {
    const { user } = setup(seed);
    await screen.findByText('Lunch');
    api.failNext(/PATCH/, 400, 'amount is too large');
    await user.click(within(rowOf('Lunch')).getByRole('button', { name: 'Edit Amount' }));
    const input = screen.getByLabelText('Amount', { selector: '.cell-editor' });
    await user.clear(input);
    await user.type(input, '999{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('amount is too large');
    expect(within(rowOf('Lunch')).getByText('₱150.00')).toBeInTheDocument(); // reverted
    expect(screen.queryByLabelText('Amount', { selector: '.cell-editor' })).not.toBeInTheDocument();
  });

  it('an invalid value stays in the editor with a message and is never sent', async () => {
    const { user } = setup(seed);
    await screen.findByText('Lunch');
    await user.click(within(rowOf('Lunch')).getByRole('button', { name: 'Edit Amount' }));
    const input = screen.getByLabelText('Amount', { selector: '.cell-editor' });
    await user.clear(input);
    await user.type(input, 'abc{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('Use numbers like 250 or 1,250.50');
    expect(screen.getByLabelText('Amount', { selector: '.cell-editor' })).toBeInTheDocument();
    expect(api.callsTo('PATCH', '/api/transactions/')).toHaveLength(0);
  });

  it('changing the category saves immediately', async () => {
    const { user } = setup(seed);
    await screen.findByText('Lunch');
    await user.click(within(rowOf('Lunch')).getByRole('button', { name: 'Edit Category' }));
    expect(screen.getByLabelText('Category', { selector: '.cell-editor' })).toBeInTheDocument(); // the list opens straight away
    await user.click(await screen.findByRole('option', { name: 'Food' }));
    await waitFor(() => expect(api.callsTo('PATCH', '/api/transactions/')).toHaveLength(1));
    expect(api.callsTo('PATCH', '/api/transactions/')[0]!.body).toEqual({ categoryId: 2 });
    expect(await within(rowOf('Lunch')).findByText('Food')).toBeInTheDocument();
  });
});

describe('types shown in the list', () => {
  it('refunds are negative with a badge; income is muted with a badge; plain expenses carry no badge', async () => {
    setup([
      { description: 'Shopee refund', kind: 'refund', amountCentavos: 44100, date: `${month}-03` },
      { description: 'Salary', kind: 'income', amountCentavos: 5000000, date: `${month}-04` },
      { description: 'Lunch', kind: 'expense', amountCentavos: 15000, date: `${month}-05` },
    ]);
    await screen.findByText('Lunch');
    const refund = rowOf('Shopee refund');
    expect(within(refund).getByText('−₱441.00')).toHaveClass('refund-amount');
    expect(within(refund).getByText('Refund')).toBeInTheDocument();
    expect(within(rowOf('Salary')).getByText('Income')).toBeInTheDocument();
    expect(within(rowOf('Salary')).getByText('₱50,000.00')).toHaveClass('excluded-amount');
    expect(within(rowOf('Lunch')).queryByText('Expense')).not.toBeInTheDocument();
  });
});

describe('delete with undo', () => {
  const seed = [{ description: 'Lunch', date: `${month}-02`, amountCentavos: 15000 }];

  it('asks for confirmation, deletes, and Undo brings it back', async () => {
    const { user } = setup(seed);
    await screen.findByText('Lunch');
    await user.click(within(rowOf('Lunch')).getByRole('button', { name: 'Delete Lunch' }));
    await user.click(within(rowOf('Lunch')).getByRole('button', { name: 'Delete' })); // the confirmation button
    await waitFor(() => expect(api.callsTo('DELETE', '/api/transactions/')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText('Lunch', { selector: 'td *, td' })).not.toBeInTheDocument());
    const toast = await screen.findByText(/Deleted ₱150\.00 · Lunch/);
    expect(toast).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(api.callsTo('POST', '/restore')).toHaveLength(1));
    expect(await screen.findByText('Lunch')).toBeInTheDocument();
  });

  it('Keep cancels the delete, and the delete toast asks for 5 seconds with an Undo action', async () => {
    const { user } = setup(seed);
    await screen.findByText('Lunch');
    await user.click(within(rowOf('Lunch')).getByRole('button', { name: 'Delete Lunch' }));
    await user.click(within(rowOf('Lunch')).getByRole('button', { name: 'Keep' }));
    expect(api.callsTo('DELETE', '/api/transactions/')).toHaveLength(0);

    await user.click(within(rowOf('Lunch')).getByRole('button', { name: 'Delete Lunch' }));
    await user.click(within(rowOf('Lunch')).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText(/Deleted ₱150\.00/)).toBeInTheDocument();
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('Deleted ₱150.00 · Lunch'), expect.objectContaining({ duration: 5000, action: expect.objectContaining({ label: 'Undo' }) }));
  });

  it('a failed delete tells you and leaves the row', async () => {
    const { user } = setup(seed);
    await screen.findByText('Lunch');
    api.failNext(/DELETE/, 500, 'internal error');
    await user.click(within(rowOf('Lunch')).getByRole('button', { name: 'Delete Lunch' }));
    await user.click(within(rowOf('Lunch')).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText(/Could not delete/)).toBeInTheDocument();
    expect(screen.getByText('Lunch')).toBeInTheDocument();
  });
});

describe('edit sheet (type and every field)', () => {
  it('changing the type sends only the changed field', async () => {
    const { user } = setup([{ description: 'Salary', date: `${month}-02`, amountCentavos: 100000 }]);
    await screen.findByText('Salary');
    await user.click(within(rowOf('Salary')).getByRole('button', { name: /Edit details of Salary/ }));
    const dialog = screen.getByRole('dialog', { name: 'Edit transaction' });
    await choose(user, within(dialog).getByRole('combobox', { name: 'Type' }), 'Income');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.callsTo('PATCH', '/api/transactions/')).toHaveLength(1));
    expect(api.callsTo('PATCH', '/api/transactions/')[0]!.body).toEqual({ kind: 'income' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(within(rowOf('Salary')).getByText('Income')).toBeInTheDocument();
  });

  it('shows validation and server errors without closing, and Esc closes', async () => {
    const { user } = setup([{ description: 'Salary', date: `${month}-02` }]);
    await screen.findByText('Salary');
    await user.click(within(rowOf('Salary')).getByRole('button', { name: /Edit details/ }));
    const dialog = screen.getByRole('dialog');
    await user.clear(within(dialog).getByLabelText('Amount'));
    await user.type(within(dialog).getByLabelText('Amount'), 'x');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText('Use numbers like 250 or 1,250.50')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('deleting from the sheet needs a confirmation too', async () => {
    const { user } = setup([{ description: 'Salary', date: `${month}-02` }]);
    await screen.findByText('Salary');
    await user.click(within(rowOf('Salary')).getByRole('button', { name: /Edit details/ }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete…' }));
    expect(api.callsTo('DELETE', '/api/transactions/')).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.callsTo('DELETE', '/api/transactions/')).toHaveLength(1));
  });
});

describe('filters, paging and range in the URL', () => {
  it('pages 50 at a time with Previous/Next, and the page lives in the URL', async () => {
    const many = Array.from({ length: 55 }, (_, i) => ({ description: `Item ${i}`, date: `${month}-02` }));
    const { user } = setup(many);
    expect(await screen.findByText('Page 1 of 2 · 55 transactions')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getAllByRole('row')).toHaveLength(51); // header + 50
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Page 2 of 2 · 55 transactions')).toBeInTheDocument();
    expect(url()).toContain('page=2');
    expect(screen.getAllByRole('row')).toHaveLength(6); // header + 5
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('category filter goes into the URL and the request', async () => {
    const { user } = setup([{ description: 'Lunch', date: `${month}-02`, categoryId: 2, categoryName: 'Food' }, { description: 'Bus', date: `${month}-03`, categoryId: 3, categoryName: 'Transport' }]);
    await screen.findByText('Lunch');
    await choose(user, screen.getByRole('combobox', { name: 'Filter by category' }), 'Food');
    await waitFor(() => expect(screen.queryByText('Bus')).not.toBeInTheDocument());
    expect(url()).toContain('category=2');
    expect(api.callsTo('GET', 'categoryId=2').length).toBeGreaterThan(0);
  });

  it('a custom range is validated and written to the URL; the same URL reopens with that range', async () => {
    const { user } = setup([{ description: 'Old', date: '2026-01-15' }], '/transactions?from=2026-01-01&to=2026-01-31');
    expect(await screen.findByText('Old')).toBeInTheDocument(); // a shared link restores the view
    expect(screen.getByRole('combobox', { name: 'Date range' })).toHaveTextContent('Custom range');
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-02-10' } });
    expect(await screen.findByText('Start date must not be after the end date')).toBeInTheDocument();
    await choose(user, screen.getByRole('combobox', { name: 'Date range' }), 'Last month');
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Date range' })).toHaveTextContent('Last month'));
    expect(screen.queryByLabelText('From')).not.toBeInTheDocument();
  });
});

describe('phone layout (below 640px)', () => {
  it('shows list rows instead of a table, adds through a bottom sheet, and edits by tapping a row', async () => {
    setMobile(true);
    const { user } = setup([{ description: 'Lunch', date: `${month}-02`, amountCentavos: 15000 }]);
    expect(await screen.findByText('Lunch')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Add an expense' })).not.toBeInTheDocument(); // hidden until asked for

    await user.click(screen.getByRole('button', { name: '+ Add expense' }));
    const sheet = screen.getByRole('dialog', { name: 'Add an expense' });
    await user.type(within(sheet).getByLabelText('Amount'), '45{Enter}');
    await waitFor(() => expect(api.callsTo('POST', '/api/transactions')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); // sheet closes after saving

    await user.click(screen.getByText('Lunch'));
    expect(screen.getByRole('dialog', { name: 'Edit transaction' })).toBeInTheDocument();
  });
});
