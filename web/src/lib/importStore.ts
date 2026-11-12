// Import work in progress lives here, outside React, so it survives the app swapping to the PIN screen when a
// session expires mid-review. Signing back in returns to the same preview with the same edits.
import { useSyncExternalStore } from 'react';
import type { Bank, Kind, Preview } from './api';

export interface RowEdit {
  include: boolean;
  categoryId: number;
  kind: Kind;
  remember: boolean;
}
export interface ImportState {
  file: File | null;
  bankChoice: Bank | null; // null = auto-detect
  status: 'idle' | 'parsing' | 'preview';
  error: { message: string; code?: string } | null;
  preview: Preview | null;
  edits: Record<number, RowEdit>;
  showOther: boolean; // the collapsed group of duplicates and non-expenses
}

const initial: ImportState = { file: null, bankChoice: null, status: 'idle', error: null, preview: null, edits: {}, showOther: false };
let state: ImportState = initial;
const listeners = new Set<() => void>();

export const getImportState = () => state;
export function setImportState(patch: Partial<ImportState> | ((s: ImportState) => Partial<ImportState>)) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  listeners.forEach((l) => l());
}
export const resetImport = () => setImportState({ ...initial });
export function useImportState(): ImportState {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), getImportState);
}

/** Default edits for a fresh preview: rows start as the server suggested. */
export function editsFor(preview: Preview): Record<number, RowEdit> {
  const out: Record<number, RowEdit> = {};
  for (const r of preview.rows) out[r.index] = { include: r.include, categoryId: r.suggestedCategoryId, kind: r.kind, remember: true };
  return out;
}
