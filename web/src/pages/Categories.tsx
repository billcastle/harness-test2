import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { EditableCell } from '../components/EditableCell';
import { useCategories, useCategoryMutations } from '../hooks';
import { api, ApiError, type Category } from '../lib/api';

const PALETTE: { name: string; hex: string }[] = [
  { name: 'green', hex: '#16a34a' }, { name: 'teal', hex: '#0d9488' }, { name: 'sky', hex: '#0ea5e9' }, { name: 'blue', hex: '#2563eb' },
  { name: 'violet', hex: '#7c3aed' }, { name: 'pink', hex: '#db2777' }, { name: 'red', hex: '#dc2626' }, { name: 'orange', hex: '#ea580c' },
  { name: 'amber', hex: '#ca8a04' }, { name: 'lime', hex: '#65a30d' }, { name: 'slate', hex: '#64748b' }, { name: 'stone', hex: '#78716c' },
];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const nameProblem = (v: string) => (v.trim().length < 1 ? 'Enter a name' : v.trim().length > 60 ? 'Keep the name under 60 characters' : null);
const errorText = (e: unknown) => (e instanceof ApiError ? e.message : 'Could not save. Check your connection and try again.');

export function CategoriesPage() {
  return (
    <div className="grid gap-10">
      <div className="grid gap-2">
        <h2 className="text-xl font-semibold tracking-tight">Categories</h2>
        <p className="text-muted-foreground">Group your spending. These appear when you add, edit and import transactions.</p>
      </div>
      <AddCategory />
      <CategoryList />
      <RememberedMerchants />
    </div>
  );
}

// ------------------------------------------------------------------ color
function ColorPicker({ value, label, onPick }: { value: string; label: string; onPick: (hex: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={label} className="size-11 shrink-0 rounded-full border-2 border-background shadow-sm outline-none ring-1 ring-border focus-visible:ring-[3px] focus-visible:ring-ring/50" style={{ backgroundColor: value }} />
      </PopoverTrigger>
      <PopoverContent className="grid w-64 grid-cols-4 gap-3 p-4" align="start">
        {PALETTE.map((c) => (
          <button
            key={c.hex}
            type="button"
            aria-label={`Use ${c.name}`}
            aria-pressed={c.hex.toLowerCase() === value.toLowerCase()}
            onClick={() => { setOpen(false); onPick(c.hex); }}
            className={`size-10 rounded-full outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-ring ${c.hex.toLowerCase() === value.toLowerCase() ? 'ring-2 ring-foreground' : ''}`}
            style={{ backgroundColor: c.hex }}
          />
        ))}
      </PopoverContent>
    </Popover>
  );
}

// ------------------------------------------------------------------ add
function AddCategory() {
  const { create } = useCategoryMutations();
  const [name, setName] = useState('');
  const [color, setColor] = useState(PALETTE[0]!.hex);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = nameProblem(name);
    if (problem) return setError(problem);
    try {
      await create.mutateAsync({ name: name.trim(), color });
      toast(`Added ${name.trim()}.`, { duration: 4000 });
      setName('');
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a category</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-5 sm:grid-cols-[auto_1fr_auto] sm:items-start" noValidate aria-label="Add a category">
          <div className="grid gap-2">
            <Label>Color</Label>
            <ColorPicker value={color} label="Choose a color for the new category" onPick={setColor} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-category">Category name</Label>
            <Input id="new-category" autoComplete="off" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? 'new-category-err' : undefined} />
            {error && <p id="new-category-err" className="text-sm text-destructive" role="alert">{error}</p>}
          </div>
          <Button type="submit" size="lg" disabled={create.isPending} className="sm:mt-[1.65rem]">{create.isPending ? 'Adding…' : 'Add category'}</Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------ list
function CategoryList() {
  const q = useCategories();
  const { update } = useCategoryMutations();
  const [deleting, setDeleting] = useState<Category | null>(null);
  const categories = q.data ?? [];

  return (
    <section className="grid gap-4" aria-label="Your categories">
      <h3 className="text-lg font-medium">Your categories{q.data ? ` (${categories.length})` : ''}</h3>
      {q.isPending ? (
        <div className="grid gap-3" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>
      ) : q.isError ? (
        <p className="text-destructive" role="alert">Could not load categories. <Button type="button" variant="link" onClick={() => void q.refetch()}>Retry</Button></p>
      ) : (
        <ul className="grid gap-3">
          {categories.map((c) => (
            <li key={c.id} data-category={c.id} className="grid items-center gap-x-5 gap-y-3 rounded-2xl border bg-card p-5 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto]">
              <ColorPicker value={c.color} label={`Change color of ${c.name}`} onPick={(hex) => update.mutate({ id: c.id, input: { color: hex } }, { onError: (e) => toast(errorText(e)) })} />
              <div className="min-w-0">
                {c.isSystem ? (
                  <p className="px-3 py-2 text-base">{c.name}<Badge variant="secondary" className="ml-3 align-middle">Default</Badge></p>
                ) : (
                  <EditableCell label="Name" type="text" initial={c.name} display={c.name} validate={nameProblem} onSave={(v) => update.mutateAsync({ id: c.id, input: { name: v.trim() } }).then(() => undefined)} />
                )}
              </div>
              <p className="text-sm text-muted-foreground tabular-nums">
                {plural(c.transactionCount, 'transaction')}{c.ruleCount > 0 ? ` · ${plural(c.ruleCount, 'remembered merchant')}` : ''}
              </p>
              {c.isSystem ? (
                <span className="text-sm text-muted-foreground">Cannot be deleted</span>
              ) : (
                <Button type="button" variant="ghost" onClick={() => setDeleting(c)} aria-label={`Delete ${c.name}`}>Delete…</Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <DeleteDialog category={deleting} onClose={() => setDeleting(null)} />
    </section>
  );
}

function DeleteDialog({ category, onClose }: { category: Category | null; onClose: () => void }) {
  const { remove } = useCategoryMutations();
  const [error, setError] = useState<string | null>(null);
  const moved = category ? category.transactionCount : 0;
  const rules = category ? category.ruleCount : 0;

  async function confirm() {
    if (!category) return;
    try {
      const r = await remove.mutateAsync(category.id);
      toast(`Deleted ${category.name}. ${plural(r.reassignedTransactions, 'transaction')} moved to Uncategorized.`, { duration: 6000 });
      setError(null);
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  }
  return (
    <Dialog open={category !== null} onOpenChange={(o) => { if (!o) { setError(null); onClose(); } }}>
      <DialogContent className="gap-6 p-8">
        <DialogHeader>
          <DialogTitle>Delete {category?.name}?</DialogTitle>
          <DialogDescription>
            {moved === 0 && rules === 0
              ? 'Nothing uses this category yet.'
              : `${plural(moved, 'transaction')}${rules > 0 ? ` and ${plural(rules, 'remembered merchant')}` : ''} will move to Uncategorized. Nothing is deleted except the category itself.`}
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <DialogFooter className="gap-3">
          <Button type="button" variant="outline" onClick={onClose}>Keep</Button>
          <Button type="button" variant="destructive" disabled={remove.isPending} onClick={() => void confirm()}>{remove.isPending ? 'Deleting…' : 'Delete category'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ remembered merchants
function RememberedMerchants() {
  const rules = useQuery({ queryKey: ['merchant-rules'], queryFn: api.merchantRules });
  const categories = useCategories().data ?? [];
  const { forget } = useCategoryMutations();
  const [filter, setFilter] = useState('');
  const nameOf = (id: number) => categories.find((c) => c.id === id)?.name ?? 'Unknown';
  const all = rules.data ?? [];
  const shown = all.filter((r) => r.merchant.includes(filter.trim().toLowerCase()) || nameOf(r.categoryId).toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Remembered merchants</CardTitle>
        <CardDescription>When you import a statement, these merchants are put in the category you chose before. Forget one if it is wrong; you can teach it again on the next import.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        {rules.isPending ? (
          <Skeleton className="h-16 rounded-2xl" />
        ) : all.length === 0 ? (
          <p className="text-muted-foreground">Nothing remembered yet. When you import a statement and pick categories, they are remembered here.</p>
        ) : (
          <>
            <div className="grid max-w-md gap-2">
              <Label htmlFor="rule-filter">Search merchants</Label>
              <Input id="rule-filter" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
            {shown.length === 0 ? (
              <p className="text-muted-foreground">No remembered merchant matches “{filter}”.</p>
            ) : (
              <ul className="grid gap-3">
                {shown.map((r) => (
                  <li key={r.merchant} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-5">
                    <div className="min-w-0">
                      <p className="break-words">{r.merchant}</p>
                      <p className="text-sm text-muted-foreground">→ {nameOf(r.categoryId)}</p>
                    </div>
                    <Button type="button" variant="outline" disabled={forget.isPending} aria-label={`Forget ${r.merchant}`} onClick={() => forget.mutate(r.merchant, { onError: (e) => toast(errorText(e)) })}>Forget</Button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
