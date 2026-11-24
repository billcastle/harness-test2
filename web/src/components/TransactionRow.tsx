import { Delete02Icon, PencilEdit01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { TableCell, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { useTransactionMutations } from '../hooks';
import type { Category, Transaction } from '../lib/api';
import { isValidDate } from '../lib/dates';
import { centavosToInput, checkAmount } from '../lib/money';
import { AmountText, KindBadge } from './AmountText';
import { EditableCell } from './EditableCell';

/** Desktop row (640px and up): every cell edits in place. */
export function TransactionRow({
  tx, categories, flash, selected, onSelect, onEdit, onDelete,
}: {
  tx: Transaction;
  categories: Category[];
  flash: boolean;
  selected: boolean;
  onSelect: (tx: Transaction, on: boolean) => void;
  onEdit: (tx: Transaction) => void;
  onDelete: (tx: Transaction) => void;
}) {
  const { update } = useTransactionMutations();
  const [confirming, setConfirming] = useState(false);
  const save = (input: Parameters<typeof update.mutateAsync>[0]['input']) => update.mutateAsync({ id: tx.id, input }).then(() => undefined);

  return (
    <TableRow className={cn('align-top', flash && 'flash bg-primary/10')} data-tx-id={tx.id} data-state={selected ? 'selected' : undefined}>
      <TableCell className="w-10">
        <Checkbox checked={selected} onCheckedChange={(v) => onSelect(tx, v === true)} aria-label={`Select ${tx.description || 'transaction'} on ${tx.date}`} />
      </TableCell>
      <TableCell className="w-44">
        <EditableCell label="Date" type="date" initial={tx.date} display={<span className="tabular-nums">{tx.date}</span>}
          validate={(v) => (isValidDate(v) ? null : 'Enter a real date')} onSave={(v) => save({ date: v })} />
      </TableCell>
      <TableCell className="min-w-64 whitespace-normal">
        <EditableCell label="Description" type="text" initial={tx.description}
          display={<>{tx.description || <span className="text-muted-foreground">No description</span>}<KindBadge kind={tx.kind} /></>}
          validate={(v) => (v.length > 500 ? 'Keep it under 500 characters' : null)} onSave={(v) => save({ description: v })} />
      </TableCell>
      <TableCell className="w-52">
        <EditableCell label="Category" type="select" initial={String(tx.categoryId)} display={tx.categoryName}
          options={categories.map((c) => ({ value: String(c.id), label: c.name }))} onSave={(v) => save({ categoryId: Number(v) })} />
      </TableCell>
      <TableCell className="w-44">
        <EditableCell label="Amount" type="amount" align="right" initial={centavosToInput(tx.amountCentavos)} display={<AmountText tx={tx} />}
          validate={checkAmount} onSave={(v) => save({ amount: v })} />
      </TableCell>
      <TableCell className="w-36">
        <div className="flex justify-end gap-2">
          {confirming ? (
            <>
              <Button type="button" variant="destructive" size="sm" onClick={() => onDelete(tx)}>Delete</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(false)}>Keep</Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" size="icon" onClick={() => onEdit(tx)} aria-label={`Edit details of ${tx.description || 'transaction'}`} title="Edit details">
                <HugeiconsIcon icon={PencilEdit01Icon} strokeWidth={2} aria-hidden />
              </Button>
              <Button type="button" variant="ghost" size="icon" onClick={() => setConfirming(true)} aria-label={`Delete ${tx.description || 'transaction'}`} title="Delete">
                <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} aria-hidden />
              </Button>
            </>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

/** Phone list row (below 640px): tapping opens the edit sheet. */
export function TransactionListItem({ tx, flash, onEdit }: { tx: Transaction; flash: boolean; onEdit: (tx: Transaction) => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onEdit(tx)}
        data-tx-id={tx.id}
        className={cn(
          'grid min-h-20 w-full grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 rounded-2xl border bg-card p-5 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50',
          flash && 'flash bg-primary/10',
        )}
      >
        <span className="min-w-0 text-base break-words">{tx.description || 'No description'}<KindBadge kind={tx.kind} /></span>
        <AmountText tx={tx} />
        <span className="text-sm text-muted-foreground">{tx.categoryName}</span>
        <span className="text-right text-sm tabular-nums text-muted-foreground">{tx.date}</span>
      </button>
    </li>
  );
}
