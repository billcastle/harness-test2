import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { detectPreset, isValidDate, manilaToday, presetRange, type Preset, type Range } from '../lib/dates';

const LABELS: Record<Preset, string> = {
  'this-month': 'This month',
  'last-month': 'Last month',
  'this-year': 'This year',
  'all-time': 'All time',
  custom: 'Custom range',
};

/** The one global date-range control. The range lives in the URL (owned by the caller); this only edits it. */
export function RangeControl({ range, onChange }: { range: Range; onChange: (r: Range) => void }) {
  const today = manilaToday();
  const detected = detectPreset(range, today);
  const [forceCustom, setForceCustom] = useState(false);
  const preset: Preset = forceCustom ? 'custom' : detected;
  const [draft, setDraft] = useState<Range>(range);
  const [error, setError] = useState<string | null>(null);

  function pick(p: Preset) {
    setError(null);
    if (p === 'custom') {
      setForceCustom(true);
      setDraft(range);
      return;
    }
    setForceCustom(false);
    onChange(presetRange(p, today));
  }
  function applyCustom(next: Range) {
    setDraft(next);
    if (!isValidDate(next.from) || !isValidDate(next.to)) return setError('Enter both dates');
    if (next.from > next.to) return setError('Start date must not be after the end date');
    setError(null);
    onChange(next);
  }

  return (
    <div className="flex flex-wrap items-end gap-5">
      <div className="grid gap-2">
        <Label htmlFor="range-preset">Date range</Label>
        <Select value={preset} onValueChange={(v) => pick(v as Preset)}>
          <SelectTrigger id="range-preset" className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(LABELS) as Preset[]).map((p) => (
              <SelectItem key={p} value={p}>{LABELS[p]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {preset === 'custom' && (
        <>
          <div className="grid gap-2">
            <Label htmlFor="range-from">From</Label>
            <Input id="range-from" type="date" value={draft.from} onChange={(e) => applyCustom({ ...draft, from: e.target.value })} aria-invalid={error ? true : undefined} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="range-to">To</Label>
            <Input id="range-to" type="date" value={draft.to} onChange={(e) => applyCustom({ ...draft, to: e.target.value })} aria-invalid={error ? true : undefined} />
          </div>
          {error && <p className="w-full text-sm text-destructive" role="alert">{error}</p>}
        </>
      )}
    </div>
  );
}
