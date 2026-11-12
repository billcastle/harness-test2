import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { QuickAddForm } from '../components/QuickAddForm';
import { RangeControl } from '../components/RangeControl';
import { Sheet } from '../components/Sheet';
import { TransactionListItem, TransactionRow } from '../components/TransactionRow';
import { TransactionSheet } from '../components/TransactionSheet';
import { useCategories, useIsMobile, useTransactionMutations } from '../hooks';
import { api, type Transaction } from '../lib/api';
import { manilaToday, rangeFromParams, type Range } from '../lib/dates';
import { formatPeso } from '../lib/money';

export function TransactionsPage() {
  const [params, setParams] = useSearchParams();
  const mobile = useIsMobile();
  const { remove, restore } = useTransactionMutations();
  const categoriesQuery = useCategories();
  const categories = categoriesQuery.data ?? [];

  // everything that defines the view lives in the URL: range, search, category, page
  const range = rangeFromParams(params, manilaToday());
  const q = params.get('q') ?? '';
  const categoryId = params.get('category') ? Number(params.get('category')) : undefined;
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);

  const patch = (changes: Record<string, string | null>) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      for (const [k, v] of Object.entries(changes)) (v === null || v === '' ? next.delete(k) : next.set(k, v));
      return next;
    });
  const setRange = (r: Range) => patch({ from: r.from, to: r.to, page: null });

  // search box: debounced into the URL
  const [qInput, setQInput] = useState(q);
  useEffect(() => setQInput(q), [q]);
  useEffect(() => {
    if (qInput === q) return;
    const t = setTimeout(() => patch({ q: qInput.trim() || null, page: null }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qInput]);

  const query = useQuery({
    queryKey: ['transactions', range.from, range.to, q, categoryId ?? null, page],
    queryFn: () => api.transactions({ from: range.from, to: range.to, q: q || undefined, categoryId, page }),
    placeholderData: keepPreviousData,
  });

  const [editing, setEditing] = useState<Transaction | null>(null);
  const [adding, setAdding] = useState(false);
  const [flashId, setFlashId] = useState<number | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  function onCreated(tx: Transaction) {
    setAdding(false);
    if (tx.date < range.from || tx.date > range.to) {
      toast(`Added ${formatPeso(tx.amountCentavos)} on ${tx.date}, which is outside the date range you are viewing.`, { duration: 6000 });
      return;
    }
    if (page !== 1) patch({ page: null });
    setFlashId(tx.id);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashId(null), 1600);
  }

  async function onDelete(tx: Transaction) {
    setEditing(null);
    try {
      await remove.mutateAsync(tx.id);
    } catch {
      toast('Could not delete. Check your connection and try again.', { duration: 6000 });
      return;
    }
    toast(`Deleted ${formatPeso(tx.amountCentavos)}${tx.description ? ` · ${tx.description}` : ''}`, {
      duration: 5000,
      action: { label: 'Undo', onClick: () => restore.mutate(tx.id) },
    });
  }

  const data = query.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filtered = Boolean(q || categoryId);
  const clearFilters = () => patch({ q: null, category: null, page: null });

  return (
    <div className="grid gap-8">
      <RangeControl range={range} onChange={setRange} />

      {!mobile && <QuickAddForm categories={categories} onCreated={onCreated} />}
      {mobile && (
        <>
          <Button type="button" size="lg" className="w-full" onClick={() => setAdding(true)}>+ Add expense</Button>
          {adding && (
            <Sheet title="Add an expense" onClose={() => setAdding(false)}>
              <QuickAddForm categories={categories} onCreated={onCreated} />
            </Sheet>
          )}
        </>
      )}

      <div className="grid gap-5 sm:grid-cols-[1fr_16rem]">
        <div className="grid gap-2">
          <Label htmlFor="search">Search description</Label>
          <Input id="search" type="search" value={qInput} onChange={(e) => setQInput(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="cat-filter">Filter by category</Label>
          <Select value={categoryId ? String(categoryId) : 'all'} onValueChange={(v) => patch({ category: v === 'all' ? null : v, page: null })}>
            <SelectTrigger id="cat-filter" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {query.isError && !data ? (
        <Alert variant="destructive" className="flex items-center justify-between gap-4 p-5">
          <span>Could not load transactions.</span>
          <Button type="button" variant="outline" onClick={() => void query.refetch()}>Retry</Button>
        </Alert>
      ) : query.isPending ? (
        <div aria-label="Loading transactions" aria-busy="true" className="grid gap-3">
          {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton className="h-16 rounded-2xl" key={i} />)}
        </div>
      ) : data && data.items.length === 0 ? (
        <div className="grid justify-items-center gap-4 rounded-3xl border border-dashed p-14 text-center">
          <p className="text-lg">{filtered ? 'No transactions match these filters.' : 'No transactions in this range.'}</p>
          {filtered ? (
            <Button type="button" variant="outline" onClick={clearFilters}>Clear filters</Button>
          ) : (
            <p className="text-muted-foreground">Add your first expense above, or pick another date range.</p>
          )}
        </div>
      ) : data ? (
        <div className="grid gap-6">
          {mobile ? (
            <ul className="grid gap-3">
              {data.items.map((tx) => <TransactionListItem key={tx.id} tx={tx} flash={tx.id === flashId} onEdit={setEditing} />)}
            </ul>
          ) : (
            <div className="rounded-3xl border bg-card p-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((tx) => (
                    <TransactionRow key={tx.id} tx={tx} categories={categories} flash={tx.id === flashId} onEdit={setEditing} onDelete={onDelete} />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <nav className="flex items-center justify-between gap-4 text-muted-foreground" aria-label="Pagination">
            <Button type="button" variant="outline" disabled={page <= 1} onClick={() => patch({ page: String(page - 1) })}>Previous</Button>
            <span className="text-center tabular-nums">Page {page} of {totalPages} · {data.total} transactions</span>
            <Button type="button" variant="outline" disabled={page >= totalPages} onClick={() => patch({ page: String(page + 1) })}>Next</Button>
          </nav>
          {query.isError && <p className="text-sm text-destructive" role="alert">Could not refresh. Showing the last loaded data.</p>}
        </div>
      ) : null}

      {editing && <TransactionSheet tx={editing} categories={categories} onClose={() => setEditing(null)} onDelete={onDelete} />}
    </div>
  );
}
