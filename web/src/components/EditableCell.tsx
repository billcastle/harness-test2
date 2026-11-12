import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { ApiError } from '../lib/api';

export interface CellOption {
  value: string;
  label: string;
}
interface Props {
  label: string; // e.g. "Amount"; used for accessible names
  display: ReactNode;
  initial: string;
  type: 'text' | 'amount' | 'date' | 'select';
  options?: CellOption[];
  align?: 'left' | 'right';
  validate?: (value: string) => string | null;
  onSave: (value: string) => Promise<void>;
}

/**
 * Click (or focus and press Enter) to edit in place. Enter saves, Esc cancels, leaving the field saves a change.
 * A failed save reverts the cell to its old value and shows the error under it.
 */
export function EditableCell({ label, display, initial, type, options, align = 'left', validate, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false); // stops Enter-then-blur from saving twice

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(t);
  }, [error]);

  function start() {
    setValue(initial);
    setError(null);
    setEditing(true);
  }
  function cancel() {
    busy.current = true; // Esc must not be followed by a blur-save
    setEditing(false);
    setTimeout(() => (busy.current = false), 0);
  }
  async function commit(next: string) {
    if (busy.current) return;
    if (next === initial) return setEditing(false);
    const problem = validate?.(next) ?? null;
    if (problem) {
      setError(problem);
      return; // stay in the editor so the value can be fixed
    }
    busy.current = true;
    setSaving(true);
    try {
      await onSave(next);
      setEditing(false);
    } catch (e) {
      setEditing(false); // revert: the display shows the old value again
      setError(e instanceof ApiError ? e.message : 'Could not save. Check your connection and try again.');
    } finally {
      setSaving(false);
      busy.current = false;
    }
  }

  const errorLine = error && <p className="px-3 pb-2 text-sm text-destructive" role="alert">{error}</p>;

  if (!editing) {
    return (
      <>
        <button
          type="button"
          aria-label={`Edit ${label}`}
          onClick={start}
          className={cn(
            'min-h-11 w-full rounded-xl px-3 py-2 text-base outline-none transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50',
            align === 'right' ? 'text-right' : 'text-left',
          )}
        >
          {display}
        </button>
        {errorLine}
      </>
    );
  }

  if (type === 'select') {
    return (
      <>
        <Select
          defaultOpen
          value={value}
          onValueChange={(v) => {
            setValue(v);
            void commit(v);
          }}
          onOpenChange={(open) => !open && !busy.current && setEditing(false)}
        >
          <SelectTrigger aria-label={label} className="cell-editor w-full" disabled={saving} autoFocus>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options?.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {errorLine}
      </>
    );
  }
  return (
    <>
      <Input
        aria-label={label}
        className={cn('cell-editor', align === 'right' && 'text-right tabular-nums')}
        type={type === 'date' ? 'date' : 'text'}
        inputMode={type === 'amount' ? 'decimal' : undefined}
        autoFocus
        disabled={saving}
        value={value}
        aria-invalid={error ? true : undefined}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void commit(value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void commit(value);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
          }
        }}
      />
      {errorLine}
    </>
  );
}
