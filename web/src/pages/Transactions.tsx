import { Cancel01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { useCategories, useIsCompact, useIsMobile, useTransactionMutations } from '../hooks';
import { api, type Transaction } from '../lib/api';
import { isValidDate, manilaToday, rangeFromParams, shortDate, type Range } from '../lib/dates';
import { formatPeso } from '../lib/money';

/** `showRange={false}` when a parent page already shows the range control (the Overview page). */
export function TransactionsPage({ showRange = true }: { showRange?: boolean }) {
  const [params, setParams] = useSearchParams();
  const mobile = useIsMobile();
  const compact = useIsCompact(); // tablets too: the inline-editable table needs about 1000px
  const { remove, restore, removeMany, restoreMany } = useTransactionMutations();
  const categoriesQuery = useCategories();
  const categories = categoriesQuery.data ?? [];

  // everything that defines the view lives in the URL: range, search, category, page
  const range = rangeFromParams(params, manilaToday());
  const q = params.get('q') ?? '';
  const dayParam = params.get('date');
  const day = isValidDate(dayParam) ? dayParam : undefined; // one exact day, whatever the range is
  const categoryId = params.get('category') ? Number(params.get('category')) : undefined;
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);
  const batchId = params.get('batch') ?? undefined; // set after an import: show exactly that import's rows, whatever their dates

  const patch = (changes: Record<string, string | null>) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      for (const [k, v] of Object.entries(changes)) (v === null || v === '' ? next.delete(k) : next.set(k, v));
      return next;
    });
  const setRange = (r: Range) => patch({ from: r.from, to: r.to, date: null, page: null });

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
    queryKey: ['transactions', batchId ?? null, range.from, range.to, day ?? null, q, categoryId ?? null, page],
    queryFn: () => api.transactions({ ...(batchId ? { batchId } : day ? { date: day } : { from: range.from, to: range.to }), q: q || undefined, categoryId, page }),
    placeholderData: keepPreviousData,
  });

  const data = query.data;
  const [editing, setEditing] = useState<Transaction | null>(null);

  // checkbox selection for batch delete; it only means something for the rows on screen, so a new view clears it
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmingBatch, setConfirmingBatch] = useState(false);
  const viewKey = `${batchId ?? ''}|${range.from}|${range.to}|${day ?? ''}|${q}|${categoryId ?? ''}|${page}`;
  useEffect(() => { setSelected(new Set()); setConfirmingBatch(false); }, [viewKey]);
  const toggle = (tx: Transaction, on: boolean) => setSelected((s) => { const n = new Set(s); if (on) n.add(tx.id); else n.delete(tx.id); return n; });
  const pageIds = data?.items.map((t) => t.id) ?? [];
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  async function deleteSelected() {
    const ids = [...selected];
    setConfirmingBatch(false);
    try {
      await removeMany.mutateAsync(ids);
    } catch {
      toast('Could not delete. Check your connection and try again.', { duration: 6000 });
      return;
    }
    setSelected(new Set());
    toast(`Deleted ${ids.length} ${ids.length === 1 ? 'transaction' : 'transactions'}`, { duration: 6000, action: { label: 'Undo', onClick: () => restoreMany.mutate(ids) } });
  }
  const [flashId, setFlashId] = useState<number | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  function onCreated(tx: Transaction) {
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


  const selectionBar = selected.size > 0 && (
    <div className={compact ? 'sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card px-4 py-3 shadow-lg' : 'flex flex-wrap items-center justify-between gap-3 px-3 py-2'} role="status">
      <span className="font-medium">{selected.size} selected</span>
      <div className="flex gap-2">
        {confirmingBatch ? (
          <>
            <Button type="button" variant="destructive" size="sm" onClick={() => void deleteSelected()}>Delete {selected.size}</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setConfirmingBatch(false)}>Keep</Button>
          </>
        ) : (
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
            <Button type="button" variant="destructive" size="sm" onClick={() => setConfirmingBatch(true)}>Delete selected</Button>
          </>
        )}
      </div>
    </div>
  );

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filtered = Boolean(q || categoryId || day);
  const clearFilters = () => patch({ q: null, category: null, date: null, page: null });

  return (
    <div className="grid gap-8">
      {batchId ? (
        <Alert className="flex flex-wrap items-center justify-between gap-4 p-5">
          <span>Showing the transactions from that import{data ? ` (${data.total})` : ''}.</span>
          <Button type="button" variant="outline" onClick={() => patch({ batch: null, page: null })}>Show everything</Button>
        </Alert>
      ) : (
        showRange && <RangeControl range={range} onChange={setRange} />
      )}

      {!mobile && <QuickAddForm categories={categories} onCreated={onCreated} />}

      <div className="grid gap-5 sm:grid-cols-[1fr_17rem_14rem]">
        <div className="grid gap-2">
          <Label htmlFor="search">Search description or amount</Label>
          <Input id="search" type="search" placeholder="Grab, 250, 250.50" value={qInput} onChange={(e) => setQInput(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="day-filter">Filter by date</Label>
          <div className="flex gap-2">
            <Input id="day-filter" className="min-w-0 flex-1" type="date" value={day ?? ''} onChange={(e) => patch({ date: e.target.value || null, page: null })} />
            {day && <Button type="button" variant="outline" size="icon" className="shrink-0" aria-label="Clear date filter" title="Clear date filter" onClick={() => patch({ date: null, page: null })}><HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} aria-hidden /></Button>}
          </div>
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
      {day && <p className="-mt-4 text-sm text-muted-foreground">Showing {shortDate(day)} only, ignoring the date range.</p>}

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
          {compact ? (
            <div className="grid gap-3">
              <label className="flex items-center gap-3 px-1 text-muted-foreground">
                <Checkbox checked={allSelected ? true : selected.size > 0 ? 'indeterminate' : false} onCheckedChange={(v) => setSelected(v === true ? new Set(pageIds) : new Set())} aria-label="Select all on this page" />
                Select all on this page
              </label>
              <ul className="grid gap-3">
                {data.items.map((tx) => <TransactionListItem key={tx.id} tx={tx} flash={tx.id === flashId} selected={selected.has(tx.id)} onSelect={toggle} onEdit={setEditing} />)}
              </ul>
              {selectionBar}
            </div>
          ) : (
            <div className="rounded-3xl border bg-card p-2">
              {selectionBar}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox checked={allSelected ? true : selected.size > 0 ? 'indeterminate' : false} onCheckedChange={(v) => setSelected(v === true ? new Set(pageIds) : new Set())} aria-label="Select all on this page" />
                    </TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((tx) => (
                    <TransactionRow key={tx.id} tx={tx} categories={categories} flash={tx.id === flashId} selected={selected.has(tx.id)} onSelect={toggle} onEdit={setEditing} onDelete={onDelete} />
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
