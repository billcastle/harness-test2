import { Add01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useCategories } from '../hooks';
import { formatPeso } from '../lib/money';
import { QuickAddForm } from './QuickAddForm';
import { Sheet } from './Sheet';

/** The always-available way to add an expense: lives in the header, opens a dialog (a bottom sheet on phones) from any page. */
export function AddExpenseButton() {
  const [open, setOpen] = useState(false);
  const categories = useCategories().data ?? [];
  return (
    <>
      <Button type="button" size="lg" onClick={() => setOpen(true)}>
        <HugeiconsIcon icon={Add01Icon} strokeWidth={2} aria-hidden />
        Add expense
      </Button>
      {open && (
        <Sheet title="Add an expense" onClose={() => setOpen(false)}>
          <QuickAddForm
            layout="stack"
            categories={categories}
            onCreated={(tx) => {
              setOpen(false);
              toast(`Added ${formatPeso(tx.amountCentavos)}${tx.description ? ` · ${tx.description}` : ''} on ${tx.date}`, { duration: 4000 });
            }}
          />
        </Sheet>
      )}
    </>
  );
}
