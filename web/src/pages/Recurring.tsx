import { Delete02Icon, PencilEdit01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { RecurringForm } from '../components/RecurringForm';
import { Sheet } from '../components/Sheet';
import { useCategories, useRecurring, useRecurringMutations } from '../hooks';
import type { Recurring } from '../lib/api';
import { shortDate } from '../lib/dates';
import { formatPeso } from '../lib/money';

export function amountLabel(r: Pick<Recurring, 'amountCentavos' | 'frequency'>): string {
  return `${formatPeso(r.amountCentavos)} / ${r.frequency === 'monthly' ? 'month' : 'year'}`;
}

function Row({ r, onEdit }: { r: Recurring; onEdit: (r: Recurring) => void }) {
  const { remove } = useRecurringMutations();
  const [confirming, setConfirming] = useState(false);
  async function del() {
    try {
      await remove.mutateAsync(r.id);
      toast(`Deleted ${r.description}`, { duration: 4000 });
    } catch {
      toast('Could not delete. Check your connection and try again.', { duration: 6000 });
      setConfirming(false);
    }
  }
  return (
    <li className={`grid gap-3 rounded-2xl border bg-card p-5 sm:grid-cols-[1fr_auto] sm:items-center ${r.ended ? 'opacity-70' : ''}`} data-recurring={r.description}>
      <div className="grid gap-1">
        <p className="flex flex-wrap items-center gap-3 text-lg font-medium break-words">
          {r.description}
          <Badge variant="secondary">{r.categoryName}</Badge>
          {r.ended && <Badge variant="outline">Ended</Badge>}
        </p>
        <p className="tabular-nums">
          <span className="font-medium">{amountLabel(r)}</span>
          {r.frequency === 'yearly' && <span className="text-muted-foreground"> · counts as {formatPeso(r.perMonthCentavos)} a month</span>}
        </p>
        <p className="text-sm text-muted-foreground">
          {r.ended ? `Ended ${shortDate(r.endDate!)}` : r.nextDue ? `Next charge ${shortDate(r.nextDue)}` : 'No more charges'} · since {shortDate(r.startDate)}
          {!r.ended && r.endDate && ` · until ${shortDate(r.endDate)}`}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {confirming ? (
          <>
            <Button type="button" variant="destructive" size="sm" onClick={() => void del()}>Delete</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(false)}>Keep</Button>
          </>
        ) : (
          <>
            <Button type="button" variant="ghost" size="icon" onClick={() => onEdit(r)} aria-label={`Edit ${r.description}`} title="Edit">
              <HugeiconsIcon icon={PencilEdit01Icon} strokeWidth={2} aria-hidden />
            </Button>
            <Button type="button" variant="ghost" size="icon" onClick={() => setConfirming(true)} aria-label={`Delete ${r.description}`} title="Delete">
              <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} aria-hidden />
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

/** Subscriptions and bills that repeat. They are counted in every month's totals; a yearly one counts as a twelfth each month. */
export function RecurringPage() {
  const query = useRecurring();
  const categories = useCategories().data ?? [];
  const [editing, setEditing] = useState<Recurring | 'new' | null>(null);
  const items = query.data ?? [];
  const active = items.filter((r) => !r.ended);
  const monthlyTotal = active.reduce((s, r) => s + r.perMonthCentavos, 0);

  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-1">
          <h2 className="text-xl font-semibold tracking-tight">Recurring expenses</h2>
          <p className="text-muted-foreground">Subscriptions and bills that repeat. They count in your totals every month, on top of your transactions.</p>
        </div>
        <Button type="button" size="lg" onClick={() => setEditing('new')}>Add recurring</Button>
      </div>

      {active.length > 0 && (
        <Card>
          <CardContent className="grid gap-1">
            <p className="text-sm text-muted-foreground">Every month, these come to</p>
            <p className="text-3xl font-semibold tracking-tight tabular-nums" data-testid="recurring-monthly-total">{formatPeso(monthlyTotal)}</p>
            <p className="text-sm text-muted-foreground">Yearly bills are counted as a twelfth. If a charge also appears in a statement you import, it is counted twice, so leave it out of the import.</p>
          </CardContent>
        </Card>
      )}

      {query.isError && !query.data ? (
        <Alert variant="destructive" className="flex items-center justify-between gap-4 p-5">
          <span>Could not load recurring expenses.</span>
          <Button type="button" variant="outline" onClick={() => void query.refetch()}>Retry</Button>
        </Alert>
      ) : query.isPending ? (
        <div className="grid gap-3" aria-busy="true" aria-label="Loading recurring expenses">{[0, 1, 2].map((i) => <Skeleton className="h-24 rounded-2xl" key={i} />)}</div>
      ) : items.length === 0 ? (
        <div className="grid justify-items-center gap-4 rounded-3xl border border-dashed p-14 text-center">
          <p className="text-lg">No recurring expenses yet.</p>
          <p className="text-muted-foreground">Add subscriptions like Netflix, or bills like rent, internet and insurance.</p>
        </div>
      ) : (
        <ul className="grid gap-4">{items.map((r) => <Row key={r.id} r={r} onEdit={setEditing} />)}</ul>
      )}

      {editing && (
        <Sheet title={editing === 'new' ? 'Add a recurring expense' : `Edit ${editing.description}`} onClose={() => setEditing(null)}>
          <RecurringForm
            categories={categories}
            recurring={editing === 'new' ? undefined : editing}
            onDone={(saved) => {
              setEditing(null);
              toast(`Saved ${saved.description} · ${amountLabel(saved)}`, { duration: 4000 });
            }}
          />
        </Sheet>
      )}
    </div>
  );
}
