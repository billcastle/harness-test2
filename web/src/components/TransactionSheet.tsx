import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTransactionMutations } from '../hooks';
import { ApiError, KINDS, type Category, type Kind, type Transaction, type TransactionInput } from '../lib/api';
import { isValidDate } from '../lib/dates';
import { centavosToInput, checkAmount } from '../lib/money';
import { KIND_LABEL } from './AmountText';
import { Sheet } from './Sheet';

/** Edit every field of one transaction, including its type (expense, income, refund, transfer, ignored). */
export function TransactionSheet({
  tx, categories, onClose, onDelete,
}: {
  tx: Transaction;
  categories: Category[];
  onClose: () => void;
  onDelete: (tx: Transaction) => void;
}) {
  const { update } = useTransactionMutations();
  const [amount, setAmount] = useState(centavosToInput(tx.amountCentavos));
  const [description, setDescription] = useState(tx.description);
  const [date, setDate] = useState(tx.date);
  const [categoryId, setCategoryId] = useState(String(tx.categoryId));
  const [kind, setKind] = useState<Kind>(tx.kind);
  const [confirming, setConfirming] = useState(false);
  const [errors, setErrors] = useState<{ amount?: string; date?: string; form?: string }>({});

  async function save(e: FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    const amountErr = checkAmount(amount);
    if (amountErr) next.amount = amountErr;
    if (!isValidDate(date)) next.date = 'Enter a real date';
    setErrors(next);
    if (next.amount || next.date) return;
    const input: TransactionInput = {};
    if (amount.trim() !== centavosToInput(tx.amountCentavos)) input.amount = amount;
    if (description !== tx.description) input.description = description;
    if (date !== tx.date) input.date = date;
    if (Number(categoryId) !== tx.categoryId) input.categoryId = Number(categoryId);
    if (kind !== tx.kind) input.kind = kind;
    if (Object.keys(input).length === 0) return onClose();
    try {
      await update.mutateAsync({ id: tx.id, input });
      onClose();
    } catch (err) {
      setErrors({ form: err instanceof ApiError ? err.message : 'Could not save. Check your connection and try again.' });
    }
  }

  return (
    <Sheet title="Edit transaction" onClose={onClose}>
      <form onSubmit={save} className="grid gap-6" noValidate>
        <div className="grid gap-2">
          <Label htmlFor="ts-amount">Amount</Label>
          <Input id="ts-amount" className="tabular-nums" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={errors.amount ? true : undefined} autoFocus />
          {errors.amount && <p className="text-sm text-destructive">{errors.amount}</p>}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="ts-category">Category</Label>
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger id="ts-category" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="ts-desc">Description</Label>
          <Input id="ts-desc" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="ts-date">Date</Label>
          <Input id="ts-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-invalid={errors.date ? true : undefined} />
          {errors.date && <p className="text-sm text-destructive">{errors.date}</p>}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="ts-kind">Type</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
            <SelectTrigger id="ts-kind" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{KINDS.map((k) => <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {errors.form && <p className="text-sm text-destructive" role="alert">{errors.form}</p>}
        <div className="flex items-center justify-between gap-4 pt-2">
          {confirming ? (
            <span className="flex gap-3">
              <Button type="button" variant="destructive" onClick={() => onDelete(tx)}>Delete</Button>
              <Button type="button" variant="outline" onClick={() => setConfirming(false)}>Keep</Button>
            </span>
          ) : (
            <Button type="button" variant="destructive" onClick={() => setConfirming(true)}>Delete…</Button>
          )}
          <Button type="submit" size="lg" disabled={update.isPending}>{update.isPending ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Sheet>
  );
}
