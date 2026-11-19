import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import type { Preview, PreviewRow } from '../src/lib/api';
import { resetImport } from '../src/lib/importStore';
import { ImportPage } from '../src/pages/Import';
import { TransactionsPage } from '../src/pages/Transactions';
import { createFakeApi, type FakeApi } from './fakeApi';
import { choose, renderWithProviders, setMobile } from './render';

let api: FakeApi;
const BATCH = '11111111-1111-4111-8111-111111111111';

const row = (over: Partial<PreviewRow> & Pick<PreviewRow, 'index' | 'description' | 'amountCentavos'>): PreviewRow => ({
  merchantKey: over.description.toLowerCase(), date: '2026-11-02', direction: 'out', kind: 'expense', reason: 'merchant payment', occurrenceIndex: 0, duplicateOf: null,
  suggestedCategoryId: 1, fromRule: false, include: true, ...over,
});
function makePreview(over: Partial<Preview> = {}): Preview {
  return {
    batchId: BATCH, bank: 'gcash', reconcile: { ok: true }, errors: [], warnings: [], cancelled: [], leftOut: [],
    rows: [
      row({ index: 0, description: 'Payment to Cafe Uno', amountCentavos: 18500 }),
      row({ index: 1, description: 'Payment to Cafe Uno', amountCentavos: 18500, occurrenceIndex: 1, date: '2026-11-07' }),
      row({ index: 2, description: 'Payment to Google', amountCentavos: 37900, date: '2026-11-03' }),
      row({ index: 3, description: 'Refund from Grab', amountCentavos: 12000, direction: 'in', kind: 'refund', date: '2026-11-06', reason: 'merchant refund' }),
      row({ index: 4, description: 'Received GCash from BPI', amountCentavos: 500000, direction: 'in', kind: 'transfer', include: false, review: true, reason: 'top-up from a bank (review)', date: '2026-11-04' }),
      row({ index: 5, description: 'Payment to Old Shop', amountCentavos: 5000, duplicateOf: 77, include: false, date: '2026-11-01' }),
    ],
    ...over,
  };
}
const pdf = (name = 'gcash.pdf') => new File(['%PDF-1.4 test'], name, { type: 'application/pdf' });
const fileInput = () => screen.getByLabelText('Statement PDF') as HTMLInputElement;
const rowEl = (i: number) => document.querySelector(`[data-row="${i}"]`) as HTMLElement;
const summary = () => screen.getByText(/rows ·/).textContent;
const confirmButton = () => screen.getByRole('button', { name: /^Import \d+ transaction/ });

async function upload(user: ReturnType<typeof renderWithProviders>['user'], preview: Preview | null = makePreview()) {
  api.state.preview = preview;
  await user.upload(fileInput(), pdf());
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localStorage.clear();
  setMobile(false);
  resetImport();
  api = createFakeApi();
  api.install();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('upload', () => {
  it('sends the PDF as the raw request body with the PDF content type, and shows the preview summary', async () => {
    const { user } = renderWithProviders(<ImportPage />, { route: '/import' });
    await upload(user);
    expect(await screen.findByText(/rows ·/)).toBeInTheDocument();
    const call = api.callsTo('POST', '/api/import/parse')[0]!;
    expect(call.url).toBe('/api/import/parse'); // bank detection is automatic by default
    expect(call.contentType).toBe('application/pdf');
    expect(call.file?.name).toBe('gcash.pdf');
    // 3 expenses (185 + 185 + 379) minus a 120 refund
    expect(summary()).toBe('6 rows · 4 will import · 1 duplicates · 0 errors · net ₱629.00');
    expect(confirmButton()).toHaveTextContent('Import 4 transactions');
    expect(screen.getByText("✓ Matches the statement's own totals")).toBeInTheDocument();
  });

  it('a chosen bank is sent along', async () => {
    const { user } = renderWithProviders(<ImportPage />, { route: '/import' });
    await choose(user, screen.getByRole('combobox', { name: 'Bank' }), 'GCash');
    await upload(user);
    await screen.findByText(/rows ·/);
    expect(api.callsTo('POST', '/api/import/parse')[0]!.url).toBe('/api/import/parse?bank=gcash');
  });

  it('shows progress with a Cancel that stops the upload and returns to the chooser without an error', async () => {
    api.state.delayMs = 5000;
    const { user } = renderWithProviders(<ImportPage />, { route: '/import' });
    await upload(user);
    expect(await screen.findByText(/Reading gcash\.pdf/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('button', { name: 'Choose PDF statement' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each([
    [422, 'Could not tell which bank this statement is from. Pick the bank and try again.'],
    [413, 'That file is larger than 10 MB.'],
    [400, 'That is not a PDF file.'],
    [422, 'This PDF is password protected. Password entry is not supported yet.'],
    [422, 'Reading this statement took too long, so it was stopped.'],
  ])('shows the server message (%#), keeps the bank chooser, and offers a way forward', async (status, message) => {
    const { user } = renderWithProviders(<ImportPage />, { route: '/import' });
    api.failNext(/POST \/api\/import\/parse/, status, message);
    await user.upload(fileInput(), pdf());
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Bank' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add transactions manually instead' })).toHaveAttribute('href', '/');
  });

  it('a network failure shows a connection message, and Try again re-sends the same file', async () => {
    const { user } = renderWithProviders(<ImportPage />, { route: '/import' });
    api.state.preview = makePreview();
    api.fetchMock.mockRejectedValueOnce(new TypeError('network down'));
    await user.upload(fileInput(), pdf());
    expect(await screen.findByText(/Check your connection/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/rows ·/)).toBeInTheDocument();
    expect(api.callsTo('POST', '/api/import/parse').at(-1)!.file?.name).toBe('gcash.pdf');
  });
});

describe('left out of the import', () => {
  it('says which refunded purchases and card payments were left out and why', async () => {
    const { user } = renderWithProviders(<ImportPage />, { route: '/import' });
    await upload(user, makePreview({
      cancelled: [{ description: 'Shopee Payment', amountCentavos: 44100, paidOn: '2026-10-11', refundedOn: '2026-10-12' }],
      leftOut: [{ description: 'Payment Received', amountCentavos: 300000, date: '2026-10-20', reason: 'credit card payment' }],
    }));
    const note = await screen.findByTestId('left-out');
    expect(note).toHaveTextContent('Shopee Payment · ₱441.00: paid Oct 11, 2026, refunded Oct 12, 2026. They cancel out, so neither is added.');
    expect(note).toHaveTextContent('Payment Received · ₱3,000.00 on Oct 20, 2026: credit card payment, not an expense.');
    expect(document.querySelector('[data-row]')?.textContent).not.toContain('Shopee Payment'); // not a row to import
  });

  it('shows no note when nothing was left out', async () => {
    const { user } = renderWithProviders(<ImportPage />, { route: '/import' });
    await upload(user);
    await screen.findByText(/rows ·/);
    expect(screen.queryByTestId('left-out')).not.toBeInTheDocument();
  });
});

describe('preview', () => {
  it('lists the rows to import first, hides duplicates and non-expenses until asked, and marks duplicates', async () => {
    const { user } = renderWithProviders(<ImportPage />, { route: '/import' });
    await upload(user);
    await screen.findByText(/rows ·/);
    expect(screen.getByRole('heading', { name: 'To import (4)' })).toBeInTheDocument();
    expect(rowEl(0)).toBeInTheDocument();
    expect(rowEl(5)).not.toBeInTheDocument(); // collapsed
    expect(rowEl(4)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show 2 duplicates and non-expense rows' }));
    expect(within(rowEl(5)).getByText('Possible duplicate')).toBeInTheDocument();
    expect(within(rowEl(5)).getByRole('link', { name: 'View existing' })).toHaveAttribute('href', '/?from=2026-11-01&to=2026-11-01');
    expect(within(rowEl(4)).getByText('Check')).toBeInTheDocument();
    expect(within(rowEl(4)).getByText('top-up from a bank (review)')).toBeInTheDocument();
    expect(within(rowEl(4)).getByRole('checkbox', { name: /Include/ })).not.toBeChecked();
    expect(within(rowEl(5)).getByRole('checkbox', { name: /Include/ })).not.toBeChecked();
  });

  it('shows unreadable rows and warnings, and says so when the totals do not match', async () => {
    const { user } = renderWithProviders(<ImportPage />, { route: '/import' });
    await upload(user, makePreview({
      reconcile: { ok: false },
      errors: [{ page: 2, reason: 'expected an amount and a balance, found 0', date: '2026-11-09 03:00 PM' }],
      warnings: [{ reason: 'balance chain mismatch (the statement is inconsistent here; amounts were still captured)', date: '2026-02-05 02:15 PM' }],
    }));
    await screen.findByText(/rows ·/);
    expect(screen.getByText(/1 row could not be read and will not be imported/)).toBeInTheDocument();
    expect(screen.getByText(/Page 2: expected an amount and a balance/)).toBeInTheDocument();
    expect(screen.getByText(/balance chain mismatch/)).toBeInTheDocument();
    expect(screen.getByText(/Does not match the statement's totals/)).toBeInTheDocument();
    expect(summary()).toContain('1 errors');
  });

  it('ticking and unticking updates the summary, the net total and the button count', async () => {
    const { user } = renderWithProviders(<ImportPage />, { route: '/import' });
    await upload(user);
    await screen.findByText(/rows ·/);
    await user.click(within(rowEl(2)).getByRole('checkbox', { name: /Include/ }));
    expect(summary()).toBe('6 rows · 3 will import · 1 duplicates · 0 errors · net ₱250.00'); // 185 + 185 - 120
    expect(confirmButton()).toHaveTextContent('Import 3 transactions');
    await user.click(screen.getByRole('button', { name: 'Show 2 duplicates and non-expense rows' }));
    await user.click(within(rowEl(5)).getByRole('checkbox', { name: /Include/ }));
    expect(confirmButton()).toHaveTextContent('Import 4 transactions');
    expect(summary()).toContain('net ₱300.00'); // the duplicate is a plain expense of 50
  });

  it('disables Import when nothing is ticked', async () => {
    const { user } = renderWithProviders(<ImportPage />, { route: '/import' });
    await upload(user, makePreview({ rows: [row({ index: 0, description: 'Only row', amountCentavos: 1000, include: false })] }));
    await screen.findByText(/rows ·/);
    expect(confirmButton()).toBeDisabled();
  });

  it('counts expenses that still need a category, and "apply to similar rows" fixes the lookalikes in one click', async () => {
    const { user } = renderWithProviders(<ImportPage />, { route: '/import' });
    await upload(user);
    await screen.findByText(/rows ·/);
    expect(screen.getByText('3 expenses still need a category')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Apply this category/ })).not.toBeInTheDocument(); // only offered after a change

    await choose(user, within(rowEl(0)).getByRole('combobox', { name: /Category for/ }), 'Food');
    expect(screen.getByText('2 expenses still need a category')).toBeInTheDocument();
    await user.click(within(rowEl(0)).getByRole('button', { name: 'Apply this category to 1 similar row' }));
    expect(within(rowEl(1)).getByRole('combobox', { name: /Category for/ })).toHaveTextContent('Food');
    expect(screen.getByText('1 expense still needs a category')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Apply this category/ })).not.toBeInTheDocument();
  });

  it('similar rows are matched by merchant, so payments that differ only by a reference number are found', async () => {
    const { user } = renderWithProviders(<ImportPage />, { route: '/import' });
    await upload(user, makePreview({
      rows: [
        row({ index: 0, description: 'Payment to Google, Merchant Transaction Number: AAA111', merchantKey: 'payment to google', amountCentavos: 37900 }),
        row({ index: 1, description: 'Payment to Google, Merchant Transaction Number: BBB222', merchantKey: 'payment to google', amountCentavos: 37900, date: '2026-11-05' }),
        row({ index: 2, description: 'Payment to Lazada', merchantKey: 'payment to lazada', amountCentavos: 52968, date: '2026-11-06' }),
      ],
    }));
    await screen.findByText(/rows ·/);
    await choose(user, within(rowEl(0)).getByRole('combobox', { name: /Category for/ }), 'Food');
    await user.click(within(rowEl(0)).getByRole('button', { name: 'Apply this category to 1 similar row' }));
    expect(within(rowEl(1)).getByRole('combobox', { name: /Category for/ })).toHaveTextContent('Food');
    expect(within(rowEl(2)).getByRole('combobox', { name: /Category for/ })).toHaveTextContent('Uncategorized'); // a different merchant is untouched
  });

  it('a category you taught earlier is pre-filled and labelled', async () => {
    const { user } = renderWithProviders(<ImportPage />, { route: '/import' });
    await upload(user, makePreview({ rows: [row({ index: 0, description: 'Payment to Cafe Uno', amountCentavos: 18500, suggestedCategoryId: 2, fromRule: true })] }));
    await screen.findByText(/rows ·/);
    expect(within(rowEl(0)).getByRole('combobox', { name: /Category for/ })).toHaveTextContent('Food');
    expect(within(rowEl(0)).getByText('category from your earlier choice')).toBeInTheDocument();
  });

  it('Discard throws the preview away and returns to the chooser', async () => {
    const { user } = renderWithProviders(<ImportPage />, { route: '/import' });
    await upload(user);
    await screen.findByText(/rows ·/);
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(await screen.findByRole('button', { name: 'Choose PDF statement' })).toBeInTheDocument();
    expect(api.callsTo('POST', '/api/import/confirm')).toHaveLength(0);
  });
});

describe('confirm', () => {
  it('sends only the ticked rows with your edits and the batch id, then goes to that batch', async () => {
    const { user } = renderWithProviders(<ImportPage />, { route: '/import' });
    await upload(user);
    await screen.findByText(/rows ·/);
    await choose(user, within(rowEl(2)).getByRole('combobox', { name: /Category for/ }), 'Transport');
    await user.click(within(rowEl(3)).getByRole('checkbox', { name: /Include/ })); // untick the refund
    await user.click(within(rowEl(1)).getByRole('checkbox', { name: /Remember category/ })); // turn off Remember for one row
    await user.click(confirmButton());

    await waitFor(() => expect(api.callsTo('POST', '/api/import/confirm')).toHaveLength(1));
    const body = api.callsTo('POST', '/api/import/confirm')[0]!.body as { batchId: string; source: string; rows: Record<string, unknown>[] };
    expect(body.batchId).toBe(BATCH);
    expect(body.source).toBe('gcash');
    expect(body.rows).toHaveLength(3);
    expect(body.rows.map((r) => [r.description, r.categoryId, r.kind, r.remember, r.occurrenceIndex])).toEqual([
      ['Payment to Cafe Uno', 1, 'expense', true, 0],
      ['Payment to Cafe Uno', 1, 'expense', false, 1],
      ['Payment to Google', 3, 'expense', true, 0],
    ]);
    expect(Object.keys(body.rows[0]!).sort()).toEqual(['amountCentavos', 'categoryId', 'date', 'description', 'kind', 'occurrenceIndex', 'remember']);
    await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent(`/?batch=${BATCH}`));
    expect(await screen.findByText('Imported 3 transactions.')).toBeInTheDocument();
  });

  it('a changed type is sent (a transfer ticked as an expense, an expense marked as a transfer)', async () => {
    const { user } = renderWithProviders(<ImportPage />, { route: '/import' });
    await upload(user);
    await screen.findByText(/rows ·/);
    await choose(user, within(rowEl(2)).getByRole('combobox', { name: /Type for/ }), 'Transfer');
    await user.click(confirmButton());
    await waitFor(() => expect(api.callsTo('POST', '/api/import/confirm')).toHaveLength(1));
    const rows = (api.callsTo('POST', '/api/import/confirm')[0]!.body as { rows: { description: string; kind: string }[] }).rows;
    expect(rows.find((r) => r.description === 'Payment to Google')!.kind).toBe('transfer');
  });

  it('double-clicking Import sends one request (the button is disabled while saving)', async () => {
    api.state.delayMs = 150;
    const { user } = renderWithProviders(<ImportPage />, { route: '/import' });
    api.state.delayMs = 0;
    await upload(user);
    await screen.findByText(/rows ·/);
    api.state.delayMs = 150;
    await user.dblClick(confirmButton());
    await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent('batch='));
    expect(api.callsTo('POST', '/api/import/confirm')).toHaveLength(1);
  });

  it('a server error shows the message and keeps the preview and every edit for another try', async () => {
    const { user } = renderWithProviders(<ImportPage />, { route: '/import' });
    await upload(user);
    await screen.findByText(/rows ·/);
    await choose(user, within(rowEl(2)).getByRole('combobox', { name: /Category for/ }), 'Transport');
    api.failNext(/POST \/api\/import\/confirm/, 400, 'one of the categories does not exist');
    await user.click(confirmButton());
    expect(await screen.findByText('one of the categories does not exist')).toBeInTheDocument();
    expect(within(rowEl(2)).getByRole('combobox', { name: /Category for/ })).toHaveTextContent('Transport');
    await user.click(confirmButton());
    await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent('batch='));
    expect(api.callsTo('POST', '/api/import/confirm')).toHaveLength(2);
    expect((api.callsTo('POST', '/api/import/confirm')[1]!.body as { batchId: string }).batchId).toBe(BATCH); // same id: a retry cannot double-import
  });
});

describe('past imports and undo', () => {
  const batches = [{ id: 'b1', source: 'gcash' as const, importedAt: '2026-11-10 09:30:00+00', count: 5, edited: 2 }, { id: 'b2', source: 'maribank' as const, importedAt: '2026-11-09 18:00:00+00', count: 12, edited: 0 }];

  it('lists past imports with counts and how many rows were edited since', async () => {
    api.state.batches = [...batches];
    renderWithProviders(<ImportPage />, { route: '/import' });
    expect(await screen.findByText('GCash · 5 transactions')).toBeInTheDocument();
    expect(screen.getByText(/2 edited since/)).toBeInTheDocument();
    expect(screen.getByText('Maribank · 12 transactions')).toBeInTheDocument();
  });

  it('says so when nothing has been imported', async () => {
    renderWithProviders(<ImportPage />, { route: '/import' });
    expect(await screen.findByText('Nothing imported yet.')).toBeInTheDocument();
  });

  it('Undo asks first, spelling out how many rows go (including edited ones), then deletes the batch', async () => {
    api.state.batches = [...batches];
    const { user } = renderWithProviders(<ImportPage />, { route: '/import' });
    await screen.findByText('GCash · 5 transactions');
    await user.click(screen.getByRole('button', { name: /Undo import of GCash/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Undo this import?' });
    expect(within(dialog).getByText(/deletes 5 transactions, including 2 you edited after importing/)).toBeInTheDocument();
    expect(api.callsTo('DELETE', '/api/import/batches')).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Delete 5' }));
    await waitFor(() => expect(api.callsTo('DELETE', '/api/import/batches/b1')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText('GCash · 5 transactions')).not.toBeInTheDocument());
    expect(screen.getByText('Maribank · 12 transactions')).toBeInTheDocument();
  });

  it('Keep closes the dialog without deleting anything', async () => {
    api.state.batches = [...batches];
    const { user } = renderWithProviders(<ImportPage />, { route: '/import' });
    await screen.findByText('GCash · 5 transactions');
    await user.click(screen.getByRole('button', { name: /Undo import of GCash/ }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Keep' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.callsTo('DELETE', '/api/import/batches')).toHaveLength(0);
  });
});

describe('transactions after an import', () => {
  it('shows exactly the imported rows, ignoring the date range, with a way back to everything', async () => {
    api = createFakeApi({ transactions: [{ description: 'Imported one', date: '2026-01-05' }] });
    api.install();
    const { user } = renderWithProviders(<TransactionsPage />, { route: `/?batch=${BATCH}` });
    expect(await screen.findByText('Imported one')).toBeInTheDocument();
    const req = api.callsTo('GET', '/api/transactions')[0]!.url;
    expect(req).toContain(`batchId=${BATCH}`);
    expect(req).not.toContain('from=');
    expect(screen.getByText(/Showing the transactions from that import/)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Date range' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show everything' }));
    expect(await screen.findByRole('combobox', { name: 'Date range' })).toBeInTheDocument();
    expect(screen.getByTestId('url')).not.toHaveTextContent('batch=');
  });
});

describe('an expired session during a review', () => {
  it('returns to the PIN screen and, after signing in, the preview and every edit are still there', async () => {
    api = createFakeApi({ signedIn: true });
    api.install();
    const { user } = renderWithProviders(<App />, { route: '/import' });
    await screen.findByText('Import a statement');
    await upload(user);
    await screen.findByText(/rows ·/);
    await choose(user, within(rowEl(2)).getByRole('combobox', { name: /Category for/ }), 'Transport');

    api.state.signedIn = false; // the session ends while you are reviewing
    await user.click(confirmButton());
    expect(await screen.findByText('Enter your PIN')).toBeInTheDocument();

    await user.type(screen.getByLabelText('PIN, 4 digits'), '4821');
    expect(await screen.findByText(/rows ·/)).toBeInTheDocument(); // the same preview
    expect(within(rowEl(2)).getByRole('combobox', { name: /Category for/ })).toHaveTextContent('Transport'); // the same edits
    await user.click(confirmButton());
    await waitFor(() => expect(api.callsTo('POST', '/api/import/confirm').length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent('batch='));
  });

  it('an upload that fails because the session expired keeps the file, so Try again works after signing in', async () => {
    api = createFakeApi({ signedIn: true });
    api.install();
    const { user } = renderWithProviders(<App />, { route: '/import' });
    await screen.findByText('Import a statement');
    api.state.preview = makePreview();
    api.state.signedIn = false;
    await user.upload(fileInput(), pdf());
    expect(await screen.findByText('Enter your PIN')).toBeInTheDocument();
    await user.type(screen.getByLabelText('PIN, 4 digits'), '4821');
    expect(await screen.findByText(/Your session ended before the upload finished/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/rows ·/)).toBeInTheDocument();
    expect(api.callsTo('POST', '/api/import/parse').at(-1)!.file?.name).toBe('gcash.pdf'); // the same file, without choosing it again
  });
});
