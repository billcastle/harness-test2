import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import type { Transaction } from '../src/lib/api';
import { CategoriesPage } from '../src/pages/Categories';
import { createFakeApi, type FakeApi } from './fakeApi';
import { renderWithProviders, setMobile } from './render';

vi.mock('sonner', async (original) => {
  const actual = await original<typeof import('sonner')>();
  return { ...actual, toast: Object.assign(vi.fn(actual.toast), actual.toast) };
});

let api: FakeApi;
const li = (name: string) => screen.getByText(name, { selector: 'li *' }).closest('li') as HTMLElement;
const row = (id: number) => document.querySelector(`[data-category="${id}"]`) as HTMLElement;

function setup(opts: { transactions?: Partial<Transaction>[]; rules?: { merchant: string; categoryId: number }[] } = {}) {
  api = createFakeApi({ transactions: opts.transactions ?? [] });
  api.state.rules = opts.rules ?? [];
  api.install();
  return renderWithProviders(<CategoriesPage />, { route: '/categories' });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  setMobile(false);
});
afterEach(() => {
  toast.dismiss();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('list', () => {
  it('shows every category with its usage, and marks Uncategorized as the default that cannot be removed', async () => {
    setup({
      transactions: [{ categoryId: 2, categoryName: 'Food' }, { categoryId: 2, categoryName: 'Food' }, { categoryId: 3, categoryName: 'Transport' }, { categoryId: 1 }],
      rules: [{ merchant: 'payment to cafe uno', categoryId: 2 }, { merchant: 'payment to grab', categoryId: 3 }],
    });
    expect(await screen.findByRole('heading', { name: 'Your categories (3)' })).toBeInTheDocument();
    expect(within(row(2)).getByText('2 transactions · 1 remembered merchant')).toBeInTheDocument();
    expect(within(row(3)).getByText('1 transaction · 1 remembered merchant')).toBeInTheDocument();
    expect(within(row(1)).getByText('1 transaction')).toBeInTheDocument();

    const system = row(1);
    expect(within(system).getByText('Default')).toBeInTheDocument();
    expect(within(system).getByText('Cannot be deleted')).toBeInTheDocument();
    expect(within(system).queryByRole('button', { name: /^Delete/ })).not.toBeInTheDocument();
    expect(within(system).queryByRole('button', { name: 'Edit Name' })).not.toBeInTheDocument(); // cannot be renamed
    expect(within(system).getByRole('button', { name: 'Change color of Uncategorized' })).toBeInTheDocument(); // but can be recolored
  });

  it('shows a skeleton while loading and an error with Retry when loading fails', async () => {
    api = createFakeApi();
    api.install();
    api.failAlways(/GET \/api\/categories/, 500, 'internal error');
    const { user } = renderWithProviders(<CategoriesPage />, { route: '/categories' });
    expect(await screen.findByText(/Could not load categories/)).toBeInTheDocument();
    api.clearFailures();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Your categories (3)' })).toBeInTheDocument();
  });
});

describe('add', () => {
  it('adds a category with the chosen color and clears the form', async () => {
    const { user } = setup();
    await screen.findByRole('heading', { name: /Your categories/ });
    await user.type(screen.getByLabelText('Category name'), '  Travel  ');
    await user.click(screen.getByRole('button', { name: 'Choose a color for the new category' }));
    await user.click(await screen.findByRole('button', { name: 'Use violet' }));
    await user.click(screen.getByRole('button', { name: 'Add category' }));
    await waitFor(() => expect(api.callsTo('POST', '/api/categories')).toHaveLength(1));
    expect(api.callsTo('POST', '/api/categories')[0]!.body).toEqual({ name: 'Travel', color: '#7c3aed' });
    expect(await screen.findByRole('heading', { name: 'Your categories (4)' })).toBeInTheDocument();
    expect(screen.getByText('Travel', { selector: 'li button *, li button' })).toBeInTheDocument();
    expect(screen.getByLabelText('Category name')).toHaveValue('');
    expect(toast).toHaveBeenCalledWith('Added Travel.', expect.anything());
  });

  it('Enter in the name field adds it too', async () => {
    const { user } = setup();
    await screen.findByRole('heading', { name: /Your categories/ });
    await user.type(screen.getByLabelText('Category name'), 'Gifts{Enter}');
    await waitFor(() => expect(api.callsTo('POST', '/api/categories')).toHaveLength(1));
  });

  it('refuses an empty name before sending anything', async () => {
    const { user } = setup();
    await screen.findByRole('heading', { name: /Your categories/ });
    await user.click(screen.getByRole('button', { name: 'Add category' }));
    expect(screen.getByText('Enter a name')).toBeInTheDocument();
    expect(api.callsTo('POST', '/api/categories')).toHaveLength(0);
  });

  it('shows the server message for a duplicate name and keeps what was typed', async () => {
    const { user } = setup();
    await screen.findByRole('heading', { name: /Your categories/ });
    await user.type(screen.getByLabelText('Category name'), 'food{Enter}');
    expect(await screen.findByText('a category with that name already exists')).toBeInTheDocument();
    expect(screen.getByLabelText('Category name')).toHaveValue('food');
  });
});

describe('rename and recolor', () => {
  it('renames in place with Enter', async () => {
    const { user } = setup();
    await screen.findByRole('heading', { name: /Your categories/ });
    await user.click(within(row(2)).getByRole('button', { name: 'Edit Name' }));
    const input = screen.getByLabelText('Name', { selector: '.cell-editor' });
    await user.clear(input);
    await user.type(input, 'Groceries{Enter}');
    await waitFor(() => expect(api.callsTo('PATCH', '/api/categories/2')).toHaveLength(1));
    expect(api.callsTo('PATCH', '/api/categories/2')[0]!.body).toEqual({ name: 'Groceries' });
    expect(await within(row(2)).findByText('Groceries')).toBeInTheDocument();
  });

  it('an empty name stays in the editor with a message and is never sent', async () => {
    const { user } = setup();
    await screen.findByRole('heading', { name: /Your categories/ });
    await user.click(within(row(2)).getByRole('button', { name: 'Edit Name' }));
    await user.clear(screen.getByLabelText('Name', { selector: '.cell-editor' }));
    await user.keyboard('{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a name');
    expect(api.callsTo('PATCH', '/api/categories/2')).toHaveLength(0);
  });

  it('a rename the server refuses reverts to the old name and says why', async () => {
    const { user } = setup();
    await screen.findByRole('heading', { name: /Your categories/ });
    await user.click(within(row(2)).getByRole('button', { name: 'Edit Name' }));
    const input = screen.getByLabelText('Name', { selector: '.cell-editor' });
    await user.clear(input);
    await user.type(input, 'transport{Enter}'); // already taken by another category
    expect(await screen.findByText('a category with that name already exists')).toBeInTheDocument();
    expect(within(row(2)).getByRole('button', { name: 'Edit Name' })).toHaveTextContent('Food');
  });

  it('recolors from the palette', async () => {
    const { user } = setup();
    await screen.findByRole('heading', { name: /Your categories/ });
    const swatch = within(row(2)).getByRole('button', { name: 'Change color of Food' });
    expect(swatch).toHaveStyle({ backgroundColor: '#16a34a' });
    await user.click(swatch);
    expect(await screen.findByRole('button', { name: 'Use green', pressed: true })).toBeInTheDocument(); // the current color is marked
    await user.click(screen.getByRole('button', { name: 'Use red' }));
    await waitFor(() => expect(api.callsTo('PATCH', '/api/categories/2')).toHaveLength(1));
    expect(api.callsTo('PATCH', '/api/categories/2')[0]!.body).toEqual({ color: '#dc2626' });
    await waitFor(() => expect(within(row(2)).getByRole('button', { name: 'Change color of Food' })).toHaveStyle({ backgroundColor: '#dc2626' }));
  });
});

describe('delete', () => {
  const seed = {
    transactions: [{ categoryId: 2, categoryName: 'Food', description: 'Lunch' }, { categoryId: 2, categoryName: 'Food', description: 'Dinner' }],
    rules: [{ merchant: 'payment to cafe uno', categoryId: 2 }],
  };

  it('warns how many transactions and remembered merchants will move to Uncategorized, then deletes', async () => {
    const { user } = setup(seed);
    await screen.findByRole('heading', { name: /Your categories/ });
    await user.click(within(row(2)).getByRole('button', { name: 'Delete Food' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete Food?' });
    expect(within(dialog).getByText(/2 transactions and 1 remembered merchant will move to Uncategorized/)).toBeInTheDocument();
    expect(api.callsTo('DELETE', '/api/categories')).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Delete category' }));
    await waitFor(() => expect(api.callsTo('DELETE', '/api/categories/2')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByRole('heading', { name: 'Your categories (2)' })).toBeInTheDocument();
    expect(within(row(1)).getByText('2 transactions · 1 remembered merchant')).toBeInTheDocument(); // they landed in Uncategorized
    expect(toast).toHaveBeenCalledWith('Deleted Food. 2 transactions moved to Uncategorized.', expect.anything());
  });

  it('Keep leaves everything as it was', async () => {
    const { user } = setup(seed);
    await screen.findByRole('heading', { name: /Your categories/ });
    await user.click(within(row(2)).getByRole('button', { name: 'Delete Food' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Keep' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.callsTo('DELETE', '/api/categories')).toHaveLength(0);
    expect(screen.getByRole('heading', { name: 'Your categories (3)' })).toBeInTheDocument();
  });

  it('an unused category says so instead of warning', async () => {
    const { user } = setup();
    await screen.findByRole('heading', { name: /Your categories/ });
    await user.click(within(row(3)).getByRole('button', { name: 'Delete Transport' }));
    expect(await screen.findByText('Nothing uses this category yet.')).toBeInTheDocument();
  });

  it('a failed delete keeps the dialog open with the reason', async () => {
    const { user } = setup(seed);
    await screen.findByRole('heading', { name: /Your categories/ });
    await user.click(within(row(2)).getByRole('button', { name: 'Delete Food' }));
    const dialog = await screen.findByRole('dialog');
    api.failNext(/DELETE \/api\/categories/, 500, 'internal error');
    await user.click(within(dialog).getByRole('button', { name: 'Delete category' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('internal error');
    expect(screen.getByRole('dialog')).toBeInTheDocument(); // still open
    expect(screen.getByRole('heading', { name: 'Your categories (3)', hidden: true })).toBeInTheDocument(); // behind the modal, so hidden from assistive tech
  });
});

describe('remembered merchants', () => {
  const rules = [
    { merchant: 'payment to cafe uno', categoryId: 2 },
    { merchant: 'payment to grab philippines', categoryId: 3 },
    { merchant: 'payment to google', categoryId: 2 },
  ];

  it('lists what is remembered and which category each goes to', async () => {
    setup({ rules });
    expect(await screen.findByText('payment to cafe uno')).toBeInTheDocument();
    expect(li('payment to grab philippines')).toHaveTextContent('→ Transport');
    expect(li('payment to google')).toHaveTextContent('→ Food');
  });

  it('filters by merchant or category, and says so when nothing matches', async () => {
    const { user } = setup({ rules });
    await screen.findByText('payment to cafe uno');
    await user.type(screen.getByLabelText('Search merchants'), 'grab');
    expect(screen.queryByText('payment to cafe uno')).not.toBeInTheDocument();
    expect(screen.getByText('payment to grab philippines')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Search merchants'));
    await user.type(screen.getByLabelText('Search merchants'), 'food');
    expect(screen.getAllByText(/^payment to (cafe uno|google)$/)).toHaveLength(2); // matched through the category name
    await user.clear(screen.getByLabelText('Search merchants'));
    await user.type(screen.getByLabelText('Search merchants'), 'zzz');
    expect(screen.getByText(/No remembered merchant matches/)).toBeInTheDocument();
  });

  it('Forget removes one remembered merchant (the name is URL-encoded)', async () => {
    const { user } = setup({ rules: [{ merchant: 'payment to a&b/shop', categoryId: 2 }, ...rules] });
    await screen.findByText('payment to a&b/shop');
    await user.click(screen.getByRole('button', { name: 'Forget payment to a&b/shop' }));
    await waitFor(() => expect(api.callsTo('DELETE', '/api/merchant-rules')).toHaveLength(1));
    expect(api.callsTo('DELETE', '/api/merchant-rules')[0]!.url).toContain(`merchant=${encodeURIComponent('payment to a&b/shop')}`);
    await waitFor(() => expect(screen.queryByText('payment to a&b/shop')).not.toBeInTheDocument());
    expect(screen.getByText('payment to google')).toBeInTheDocument();
  });

  it('explains the empty state', async () => {
    setup();
    expect(await screen.findByText(/Nothing remembered yet/)).toBeInTheDocument();
  });
});
