import { useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTransactionMutations } from '../hooks';
import { ApiError, type Category, type Transaction } from '../lib/api';
import { isValidDate, manilaToday } from '../lib/dates';
import { checkAmount } from '../lib/money';

const LAST_CATEGORY_KEY = 'expenses.lastCategoryId';

/**
 * Tab order: Amount, Category (a select, defaulting to the last used), Description, Date (defaults to today in Asia/Manila).
 * Enter in Amount, Description or Date saves; the form then clears Amount and Description and puts focus back on Amount.
 */
export function QuickAddForm({ categories, onCreated, layout = 'row' }: { categories: Category[]; onCreated: (tx: Transaction) => void; layout?: 'row' | 'stack' }) {
  const { create } = useTransactionMutations();
  const stack = layout === 'stack'; // inside a dialog: one field per line instead of one wide row
  const uid = useId();
  const amountRef = useRef<HTMLInputElement>(null);
  const lastId = Number(localStorage.getItem(LAST_CATEGORY_KEY));
  const defaultId = (categories.find((c) => c.id === lastId) ?? categories.find((c) => c.isSystem))?.id;
  // null = the user has not picked one, so show the remembered default (the list may load after mount)
  const [pickedCategory, setPickedCategory] = useState<string | null>(null);
  const categoryId = pickedCategory ?? (defaultId ? String(defaultId) : '');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(() => manilaToday());
  const [errors, setErrors] = useState<{ amount?: string; date?: string; form?: string }>({});

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    const amountErr = checkAmount(amount);
    if (amountErr) next.amount = amountErr;
    if (!isValidDate(date)) next.date = 'Enter a real date';
    setErrors(next);
    if (next.amount || next.date) {
      if (next.amount) amountRef.current?.focus();
      return;
    }
    try {
      const tx = await create.mutateAsync({ amount, date, description, ...(categoryId ? { categoryId: Number(categoryId) } : {}) });
      if (categoryId) localStorage.setItem(LAST_CATEGORY_KEY, categoryId);
      setPickedCategory(categoryId);
      setAmount('');
      setDescription('');
      onCreated(tx);
      amountRef.current?.focus();
    } catch (err) {
      setErrors({ form: err instanceof ApiError ? err.message : 'Could not save. Check your connection and try again.' });
    }
  }

  return (
    <form
      className={stack ? 'grid gap-5' : 'grid gap-5 rounded-3xl border bg-card p-6 sm:grid-cols-[9rem_13rem_1fr_11rem_auto] sm:items-start'}
      onSubmit={submit}
      aria-label="Add an expense"
      noValidate
    >
      <div className="grid gap-2">
        <Label htmlFor={`${uid}-amount`}>Amount</Label>
        <Input
          id={`${uid}-amount`}
          ref={amountRef}
          className="tabular-nums"
          inputMode="decimal"
          autoComplete="off"
          autoFocus
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-invalid={errors.amount ? true : undefined}
          aria-describedby={errors.amount ? `${uid}-amount-err` : undefined}
        />
        {errors.amount && <p className="text-sm text-destructive" id={`${uid}-amount-err`}>{errors.amount}</p>}
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${uid}-cat`}>Category</Label>
        <Select value={categoryId} onValueChange={setPickedCategory} disabled={categories.length === 0}>
          <SelectTrigger id={`${uid}-cat`} className="w-full">
            <SelectValue placeholder="Loading…" />
          </SelectTrigger>
          <SelectContent>
            {categories.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${uid}-desc`}>Description</Label>
        <Input id={`${uid}-desc`} autoComplete="off" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${uid}-date`}>Date</Label>
        <Input id={`${uid}-date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-invalid={errors.date ? true : undefined} />
        {errors.date && <p className="text-sm text-destructive">{errors.date}</p>}
      </div>
      <Button type="submit" size="lg" disabled={create.isPending} className={stack ? '' : 'sm:mt-[1.65rem]'}>
        {create.isPending ? 'Saving…' : 'Add'}
      </Button>
      {errors.form && <p className={stack ? 'text-sm text-destructive' : 'text-sm text-destructive sm:col-span-5'} role="alert">{errors.form}</p>}
    </form>
  );
}
