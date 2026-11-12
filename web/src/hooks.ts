import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type TransactionInput } from './lib/api';

export function useMediaQuery(query: string): boolean {
  const get = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const m = window.matchMedia(query);
    const on = () => setMatches(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return matches;
}

/** Below 640px the app shows list rows and bottom sheets instead of the inline-editable table. */
export const useIsMobile = () => useMediaQuery('(max-width: 639px)');

export const useCategories = () => useQuery({ queryKey: ['categories'], queryFn: api.categories });

/** Every mutation invalidates the lists and the dashboard summary, so totals never go stale after an edit. */
export function useTransactionMutations() {
  const qc = useQueryClient();
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['transactions'] }), qc.invalidateQueries({ queryKey: ['summary'] })]);
  const create = useMutation({ mutationFn: (i: TransactionInput) => api.createTransaction(i), onSuccess: refresh });
  const update = useMutation({ mutationFn: (v: { id: number; input: TransactionInput }) => api.updateTransaction(v.id, v.input), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: number) => api.deleteTransaction(id), onSuccess: refresh });
  const restore = useMutation({ mutationFn: (id: number) => api.restoreTransaction(id), onSuccess: refresh });
  return { create, update, remove, restore };
}

/** Category changes touch what the lists, the pickers and the dashboard show, so everything that depends on them refreshes. */
export function useCategoryMutations() {
  const qc = useQueryClient();
  const refresh = () =>
    Promise.all(['categories', 'merchant-rules', 'transactions', 'summary'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  const create = useMutation({ mutationFn: (i: { name: string; color?: string }) => api.createCategory(i), onSuccess: refresh });
  const update = useMutation({ mutationFn: (v: { id: number; input: { name?: string; color?: string } }) => api.updateCategory(v.id, v.input), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: number) => api.deleteCategory(id), onSuccess: refresh });
  const forget = useMutation({ mutationFn: (merchant: string) => api.deleteMerchantRule(merchant), onSuccess: refresh });
  return { create, update, remove, forget };
}
