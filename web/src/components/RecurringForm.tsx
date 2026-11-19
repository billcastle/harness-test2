import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useRecurringMutations } from '../hooks';
import { ApiError, FREQUENCY_LABEL, type Category, type Frequency, type Recurring } from '../lib/api';
import { isValidDate, manilaToday } from '../lib/dates';
import { centavosToInput, checkAmount, formatPeso } from '../lib/money';

/** Add or edit a subscription or bill. `recurring` set = editing it. */
export function RecurringForm({ categories, recurring, onDone }: { categories: Category[]; recurring?: Recurring; onDone: (saved: Recurring) => void }) {
  const { create, update } = useRecurringMutations();
  const uid = useId();
  const [description, setDescription] = useState(recurring?.description ?? '');
  const [amount, setAmount] = useState(recurring ? centavosToInput(recurring.amountCentavos) : '');
  const [frequency, setFrequency] = useState<Frequency>(recurring?.frequency ?? 'monthly');
  const [categoryId, setCategoryId] = useState(String(recurring?.categoryId ?? categories.find((c) => c.isSystem)?.id ?? ''));
  const [startDate, setStartDate] = useState(recurring?.startDate ?? manilaToday());
  const [endDate, setEndDate] = useState(recurring?.endDate ?? '');
  const [errors, setErrors] = useState<{ description?: string; amount?: string; startDate?: string; endDate?: string; form?: string }>({});
  const pending = create.isPending || update.isPending;

  const amountOk = checkAmount(amount) === null;
  const perMonth = amountOk && frequency === 'yearly' ? Math.round(Number(amount.replace(/,/g, '')) * 100 / 12) : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (!description.trim()) next.description = 'Enter a name, like Netflix or Electricity';
    const amountErr = checkAmount(amount);
    if (amountErr) next.amount = amountErr;
    if (!isValidDate(startDate)) next.startDate = 'Enter a real date';
    if (endDate && !isValidDate(endDate)) next.endDate = 'Enter a real date or leave it empty';
    else if (endDate && startDate && endDate < startDate) next.endDate = 'The last charge cannot be before the first';
    setErrors(next);
    if (Object.keys(next).length) return;
    const input = { description: description.trim(), amount, frequency, categoryId: Number(categoryId), startDate, endDate: endDate || null };
    try {
      onDone(recurring ? await update.mutateAsync({ id: recurring.id, input }) : await create.mutateAsync(input));
    } catch (err) {
      setErrors({ form: err instanceof ApiError ? err.message : 'Could not save. Check your connection and try again.' });
    }
  }

  return (
    <form className="grid gap-5" onSubmit={submit} aria-label={recurring ? 'Edit recurring expense' : 'Add recurring expense'} noValidate>
      <div className="grid gap-2">
        <Label htmlFor={`${uid}-name`}>Name</Label>
        <Input id={`${uid}-name`} autoFocus autoComplete="off" maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} aria-invalid={errors.description ? true : undefined} />
        {errors.description && <p className="text-sm text-destructive">{errors.description}</p>}
      </div>
      <div className="grid items-start gap-5 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={`${uid}-amount`}>Amount</Label>
          <Input id={`${uid}-amount`} className="tabular-nums" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={errors.amount ? true : undefined} />
          {errors.amount && <p className="text-sm text-destructive">{errors.amount}</p>}
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${uid}-freq`}>Repeats</Label>
          <Select value={frequency} onValueChange={(v) => setFrequency(v as Frequency)}>
            <SelectTrigger id={`${uid}-freq`} className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(FREQUENCY_LABEL) as Frequency[]).map((f) => <SelectItem key={f} value={f}>{FREQUENCY_LABEL[f]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      {perMonth !== null && <p className="-mt-2 text-sm text-muted-foreground" data-testid="per-month-hint">Counts as {formatPeso(perMonth)} in each month&apos;s view.</p>}
      <div className="grid gap-2">
        <Label htmlFor={`${uid}-cat`}>Category</Label>
        <Select value={categoryId} onValueChange={setCategoryId} disabled={categories.length === 0}>
          <SelectTrigger id={`${uid}-cat`} className="w-full"><SelectValue placeholder="Loading…" /></SelectTrigger>
          <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="grid items-start gap-5 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={`${uid}-start`}>First charge</Label>
          <Input id={`${uid}-start`} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} aria-invalid={errors.startDate ? true : undefined} />
          {errors.startDate && <p className="text-sm text-destructive">{errors.startDate}</p>}
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${uid}-end`}>Last charge (optional)</Label>
          <Input id={`${uid}-end`} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} aria-invalid={errors.endDate ? true : undefined} />
          {errors.endDate ? <p className="text-sm text-destructive">{errors.endDate}</p> : <p className="text-sm text-muted-foreground">Leave empty while it continues.</p>}
        </div>
      </div>
      <Button type="submit" size="lg" disabled={pending}>{pending ? 'Saving…' : recurring ? 'Save changes' : 'Add recurring expense'}</Button>
      {errors.form && <p className="text-sm text-destructive" role="alert">{errors.form}</p>}
    </form>
  );
}
