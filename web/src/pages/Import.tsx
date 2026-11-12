import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type DragEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { KIND_LABEL } from '../components/AmountText';
import { useCategories } from '../hooks';
import { api, ApiError, BANK_LABEL, KINDS, type Bank, type ImportBatch, type Kind, type Preview, type PreviewRow } from '../lib/api';
import { editsFor, resetImport, setImportState, useImportState, type RowEdit } from '../lib/importStore';
import { formatPeso } from '../lib/money';

let abort: AbortController | null = null;

export function ImportPage() {
  const s = useImportState();
  return (
    <div className="grid gap-10">
      <div className="grid gap-2">
        <h2 className="text-xl font-semibold tracking-tight">Import a statement</h2>
        <p className="text-muted-foreground">Upload a bank statement PDF, review what was found, then import it. Nothing is saved until you confirm.</p>
      </div>
      {s.status === 'preview' && s.preview ? <PreviewPanel preview={s.preview} /> : <UploadCard />}
      <History />
    </div>
  );
}

// ------------------------------------------------------------------ upload
function UploadCard() {
  const s = useImportState();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const parsing = s.status === 'parsing';

  async function start(file: File, bank: Bank | null) {
    abort?.abort();
    abort = new AbortController();
    setImportState({ file, status: 'parsing', error: null });
    try {
      const preview = await api.parseStatement(file, bank, abort.signal);
      setImportState({ status: 'preview', preview, edits: editsFor(preview), showOther: false, error: null });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return setImportState({ status: 'idle' });
      if (e instanceof ApiError && e.status === 401) return setImportState({ status: 'idle', error: { message: 'Your session ended before the upload finished. Sign in, then try again.' } }); // the PIN screen takes over; the file is kept
      setImportState({
        status: 'idle',
        error: e instanceof ApiError ? { message: e.message, ...(e.code ? { code: e.code } : {}) } : { message: 'Could not upload the statement. Check your connection and try again.' },
      });
    }
  }
  const pick = (f: File | undefined) => f && void start(f, s.bankChoice);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    pick(e.dataTransfer.files[0]);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Choose a statement</CardTitle>
        <CardDescription>GCash, BPI credit card and Maribank PDFs are supported. Up to 10 MB. The file is read and then discarded; only the transactions you confirm are kept.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <div className="grid max-w-xs gap-2">
          <Label htmlFor="bank-choice">Bank</Label>
          <Select value={s.bankChoice ?? 'auto'} onValueChange={(v) => setImportState({ bankChoice: v === 'auto' ? null : (v as Bank) })} disabled={parsing}>
            <SelectTrigger id="bank-choice" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Detect automatically</SelectItem>
              {(Object.keys(BANK_LABEL) as Bank[]).map((b) => <SelectItem key={b} value={b}>{BANK_LABEL[b]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`grid justify-items-center gap-4 rounded-3xl border border-dashed p-12 text-center transition-colors ${dragging ? 'border-primary bg-primary/5' : ''}`}
        >
          {parsing ? (
            <>
              <p role="status" aria-live="polite" className="text-lg">Reading {s.file?.name ?? 'statement'}…</p>
              <Skeleton className="h-3 w-56 rounded-full" />
              <Button type="button" variant="outline" onClick={() => abort?.abort()}>Cancel</Button>
            </>
          ) : (
            <>
              <p className="text-lg">Drop a PDF here, or</p>
              <input ref={input} id="statement-file" aria-label="Statement PDF" type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
              <Button type="button" size="lg" onClick={() => input.current?.click()}>Choose PDF statement</Button>
            </>
          )}
        </div>

        {s.error && (
          <Alert variant="destructive" className="grid gap-3 p-5">
            <p>{s.error.message}</p>
            <div className="flex flex-wrap gap-3">
              {s.file && <Button type="button" variant="outline" onClick={() => void start(s.file!, s.bankChoice)}>Try again</Button>}
              <Button type="button" variant="outline" asChild><Link to="/transactions">Add transactions manually instead</Link></Button>
            </div>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------ preview
function PreviewPanel({ preview }: { preview: Preview }) {
  const s = useImportState();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const categories = useCategories().data ?? [];
  const uncategorized = categories.find((c) => c.isSystem)?.id;

  const edit = (index: number, patch: Partial<RowEdit>) =>
    setImportState((st) => ({ edits: { ...st.edits, [index]: { ...st.edits[index]!, ...patch } } }));

  // grouped by what the server found, so rows do not jump around as you tick them
  const main = preview.rows.filter((r) => r.duplicateOf === null && (r.kind === 'expense' || r.kind === 'refund'));
  const other = preview.rows.filter((r) => !main.includes(r));
  const picked = preview.rows.filter((r) => s.edits[r.index]?.include);
  const duplicates = preview.rows.filter((r) => r.duplicateOf !== null).length;
  const net = picked.reduce((sum, r) => {
    const k = s.edits[r.index]!.kind;
    return sum + (k === 'expense' ? r.amountCentavos : k === 'refund' ? -r.amountCentavos : 0);
  }, 0);
  const needsCategory = picked.filter((r) => s.edits[r.index]!.kind === 'expense' && s.edits[r.index]!.categoryId === uncategorized).length;

  const confirm = useMutation({
    mutationFn: () =>
      api.confirmImport({
        batchId: preview.batchId,
        source: preview.bank,
        rows: picked.map((r) => {
          const e = s.edits[r.index]!;
          return { date: r.date, description: r.description, amountCentavos: r.amountCentavos, kind: e.kind, categoryId: e.categoryId, occurrenceIndex: r.occurrenceIndex, remember: e.remember };
        }),
      }),
    onSuccess: async (res) => {
      resetImport();
      await Promise.all([qc.invalidateQueries({ queryKey: ['transactions'] }), qc.invalidateQueries({ queryKey: ['summary'] }), qc.invalidateQueries({ queryKey: ['import-batches'] }), qc.invalidateQueries({ queryKey: ['categories'] })]);
      toast(`Imported ${res.inserted} transaction${res.inserted === 1 ? '' : 's'}.`, { duration: 6000 });
      navigate(`/transactions?batch=${res.batchId}`);
    },
  });

  const rowProps = (r: PreviewRow) => ({
    row: r,
    edit: s.edits[r.index]!,
    categories,
    onChange: (p: Partial<RowEdit>) => edit(r.index, p),
    similar: similarCount(preview.rows, s.edits, r),
    onApplySimilar: () => preview.rows.filter((o) => o.index !== r.index && o.merchantKey === r.merchantKey).forEach((o) => edit(o.index, { categoryId: s.edits[r.index]!.categoryId })),
  });

  return (
    <div className="grid gap-8">
      <div className="sticky top-0 z-10 grid gap-4 rounded-3xl border bg-background/95 p-6 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-lg font-medium tabular-nums" aria-live="polite">
            {preview.rows.length} rows · {picked.length} will import · {duplicates} duplicates · {preview.errors.length} errors · net {formatPeso(net)}
          </p>
          <div className="flex gap-3">
            <Button type="button" variant="outline" onClick={() => resetImport()}>Discard</Button>
            <Button type="button" size="lg" disabled={picked.length === 0 || confirm.isPending} onClick={() => confirm.mutate()}>
              {confirm.isPending ? 'Importing…' : `Import ${picked.length} transaction${picked.length === 1 ? '' : 's'}`}
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Badge variant="outline">{BANK_LABEL[preview.bank]}{s.file ? ` · ${s.file.name}` : ''}</Badge>
          {preview.reconcile.ok ? (
            <span className="text-primary">✓ Matches the statement's own totals</span>
          ) : (
            <span className="text-destructive">⚠ Does not match the statement's totals. Check the rows below before importing.</span>
          )}
          {needsCategory > 0 && <span className="text-muted-foreground">{needsCategory} expense{needsCategory === 1 ? ' still needs' : 's still need'} a category</span>}
        </div>
        {confirm.isError && (
          <p className="text-sm text-destructive" role="alert">
            {confirm.error instanceof ApiError ? confirm.error.message : 'Could not import. Check your connection and try again.'}
          </p>
        )}
      </div>

      {preview.errors.length > 0 && (
        <Alert variant="destructive" className="grid gap-3 p-5">
          <p className="font-medium">{preview.errors.length} row{preview.errors.length === 1 ? '' : 's'} could not be read and will not be imported. Add them manually if you need them.</p>
          <ul className="grid gap-1 text-sm">
            {preview.errors.map((e, i) => <li key={i}>{e.page ? `Page ${e.page}: ` : ''}{e.reason}{e.date ? ` (${e.date})` : ''}{e.text ? ` “${e.text}”` : ''}</li>)}
          </ul>
        </Alert>
      )}
      {preview.warnings.length > 0 && (
        <Alert className="grid gap-2 p-5">
          <p className="font-medium">Worth knowing</p>
          <ul className="grid gap-1 text-sm text-muted-foreground">
            {preview.warnings.map((w, i) => <li key={i}>{w.reason}{w.date ? ` (${w.date})` : ''}</li>)}
          </ul>
        </Alert>
      )}

      <section className="grid gap-4" aria-label="Rows to import">
        <h3 className="text-lg font-medium">To import ({main.length})</h3>
        <RowHeader />
        {main.length === 0 ? <p className="text-muted-foreground">No expenses were found in this statement.</p> : <ul className="grid gap-3">{main.map((r) => <PreviewRowItem key={r.index} {...rowProps(r)} />)}</ul>}
      </section>

      {other.length > 0 && (
        <section className="grid gap-4" aria-label="Duplicates and other rows">
          <Button type="button" variant="outline" className="w-fit" aria-expanded={s.showOther} onClick={() => setImportState({ showOther: !s.showOther })}>
            {s.showOther ? 'Hide' : 'Show'} {other.length} duplicate{other.length === 1 ? '' : 's'} and non-expense row{other.length === 1 ? '' : 's'}
          </Button>
          {s.showOther && (
            <>
              <p className="text-sm text-muted-foreground">Transfers, income and rows that look like ones you already imported start unticked. Tick any you want to include.</p>
              <RowHeader />
              <ul className="grid gap-3">{other.map((r) => <PreviewRowItem key={r.index} {...rowProps(r)} />)}</ul>
            </>
          )}
        </section>
      )}
    </div>
  );
}

function similarCount(rows: PreviewRow[], edits: Record<number, RowEdit>, r: PreviewRow): number {
  const mine = edits[r.index];
  if (!mine || mine.categoryId === r.suggestedCategoryId) return 0; // only offered once you have changed this row
  return rows.filter((o) => o.index !== r.index && o.merchantKey === r.merchantKey && edits[o.index]?.categoryId !== mine.categoryId).length;
}

const COLS = 'sm:grid-cols-[2.5rem_6.5rem_minmax(0,1fr)_9rem_12rem_6.5rem_7.5rem]';
function RowHeader() {
  return (
    <div className={`hidden gap-4 px-5 text-sm text-muted-foreground sm:grid ${COLS}`} aria-hidden="true">
      <span /><span>Date</span><span>Description</span><span>Type</span><span>Category</span><span>Remember</span><span className="text-right">Amount</span>
    </div>
  );
}

function PreviewRowItem({ row, edit, categories, onChange, similar, onApplySimilar }: {
  row: PreviewRow;
  edit: RowEdit;
  categories: { id: number; name: string }[];
  onChange: (p: Partial<RowEdit>) => void;
  similar: number;
  onApplySimilar: () => void;
}) {
  const label = row.description || 'row';
  return (
    <li className={`grid items-center gap-x-4 gap-y-3 rounded-2xl border bg-card p-5 ${COLS} ${edit.include ? '' : 'opacity-70'}`} data-row={row.index}>
      <Checkbox checked={edit.include} onCheckedChange={(v) => onChange({ include: v === true })} aria-label={`Include ${label}`} />
      <span className="tabular-nums">{row.date}{row.dateApprox ? <span className="block text-xs text-muted-foreground">month end</span> : null}</span>
      <div className="min-w-0">
        <p className="break-words">{row.description || 'No description'}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {row.duplicateOf !== null && (
            <>
              <Badge variant="secondary">Possible duplicate</Badge>
              <Link className="text-sm text-primary underline-offset-4 hover:underline" to={`/transactions?from=${row.date}&to=${row.date}`}>View existing</Link>
            </>
          )}
          {row.review && <Badge variant="outline">Check</Badge>}
          {row.fromRule && <span className="text-xs text-muted-foreground">category from your earlier choice</span>}
        </div>
        {row.review && <p className="mt-1 text-xs text-muted-foreground">{row.reason}</p>}
        {similar > 0 && (
          <Button type="button" variant="link" size="sm" className="mt-1 h-auto p-0" onClick={onApplySimilar}>Apply this category to {similar} similar row{similar === 1 ? '' : 's'}</Button>
        )}
      </div>
      <Select value={edit.kind} onValueChange={(v) => onChange({ kind: v as Kind })}>
        <SelectTrigger className="w-full" aria-label={`Type for ${label}`}><SelectValue /></SelectTrigger>
        <SelectContent>{KINDS.map((k) => <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={String(edit.categoryId)} onValueChange={(v) => onChange({ categoryId: Number(v) })}>
        <SelectTrigger className="w-full" aria-label={`Category for ${label}`}><SelectValue /></SelectTrigger>
        <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
      </Select>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={edit.remember} onCheckedChange={(v) => onChange({ remember: v === true })} aria-label={`Remember category for ${label}`} />
        <span className="sm:sr-only">Remember</span>
      </label>
      <span className={`text-right tabular-nums sm:text-right ${row.kind === 'refund' ? 'text-primary' : ''}`}>{formatPeso(row.amountCentavos)}</span>
    </li>
  );
}

// ------------------------------------------------------------------ history and undo
function History() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['import-batches'], queryFn: api.importBatches });
  const [target, setTarget] = useState<ImportBatch | null>(null);
  const undo = useMutation({
    mutationFn: (id: string) => api.undoImport(id),
    onSuccess: async (res) => {
      setTarget(null);
      await Promise.all([qc.invalidateQueries({ queryKey: ['import-batches'] }), qc.invalidateQueries({ queryKey: ['transactions'] }), qc.invalidateQueries({ queryKey: ['summary'] })]);
      toast(`Removed ${res.deleted} transaction${res.deleted === 1 ? '' : 's'} from that import.`, { duration: 6000 });
    },
  });
  const batches = q.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Past imports</CardTitle>
        <CardDescription>Undo removes every transaction that came from an import, including ones you edited afterwards.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {q.isPending ? <Skeleton className="h-16 rounded-2xl" /> : batches.length === 0 ? (
          <p className="text-muted-foreground">Nothing imported yet.</p>
        ) : (
          <ul className="grid gap-3">
            {batches.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-5">
                <div>
                  <p className="font-medium">{BANK_LABEL[b.source]} · {b.count} transaction{b.count === 1 ? '' : 's'}</p>
                  <p className="text-sm text-muted-foreground tabular-nums">{b.importedAt.slice(0, 16)}{b.edited > 0 ? ` · ${b.edited} edited since` : ''}</p>
                </div>
                <div className="flex gap-3">
                  <Button type="button" variant="outline" asChild><Link to={`/transactions?batch=${b.id}`}>View</Link></Button>
                  <Button type="button" variant="destructive" onClick={() => setTarget(b)} aria-label={`Undo import of ${BANK_LABEL[b.source]} from ${b.importedAt.slice(0, 16)}`}>Undo…</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <Dialog open={target !== null} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent className="gap-6 p-8">
          <DialogHeader>
            <DialogTitle>Undo this import?</DialogTitle>
            <DialogDescription>
              This deletes {target?.count} transaction{target?.count === 1 ? '' : 's'}
              {target && target.edited > 0 ? `, including ${target.edited} you edited after importing` : ''}. Categories you taught the app are kept.
            </DialogDescription>
          </DialogHeader>
          {undo.isError && <p className="text-sm text-destructive" role="alert">{undo.error instanceof ApiError ? undo.error.message : 'Could not undo. Try again.'}</p>}
          <DialogFooter className="gap-3">
            <Button type="button" variant="outline" onClick={() => setTarget(null)}>Keep</Button>
            <Button type="button" variant="destructive" disabled={undo.isPending} onClick={() => target && undo.mutate(target.id)}>{undo.isPending ? 'Deleting…' : `Delete ${target?.count ?? ''}`}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
