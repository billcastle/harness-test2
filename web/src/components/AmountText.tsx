import { Badge } from '@/components/ui/badge';
import type { Transaction } from '../lib/api';
import { formatPeso } from '../lib/money';

/** Refunds show negative in the accent color; income, transfers and ignored rows are muted because they are not part of the totals. */
export function AmountText({ tx }: { tx: Pick<Transaction, 'kind' | 'amountCentavos'> }) {
  const text = formatPeso(tx.amountCentavos);
  if (tx.kind === 'refund') return <span className="refund-amount font-medium text-primary tabular-nums">−{text}</span>;
  if (tx.kind !== 'expense') return <span className="excluded-amount text-muted-foreground tabular-nums">{text}</span>;
  return <span className="tabular-nums">{text}</span>;
}

export const KIND_LABEL: Record<Transaction['kind'], string> = {
  expense: 'Expense',
  income: 'Income',
  refund: 'Refund',
  transfer: 'Transfer',
  ignored: 'Ignored',
};

export function KindBadge({ kind }: { kind: Transaction['kind'] }) {
  if (kind === 'expense') return null; // the common case carries no badge
  return (
    <Badge variant={kind === 'refund' ? 'default' : 'secondary'} className="ml-3 align-middle">
      {KIND_LABEL[kind]}
    </Badge>
  );
}
