import type { ReactNode } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet as UiSheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useIsMobile } from '../hooks';

/** A bottom sheet on phones and a centered dialog on larger screens. Esc and the backdrop close it. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const mobile = useIsMobile();
  const change = (open: boolean) => !open && onClose();
  if (mobile) {
    return (
      <UiSheet open onOpenChange={change}>
        <SheetContent side="bottom" className="max-h-[92dvh] gap-6 overflow-auto rounded-t-3xl p-6">
          <SheetHeader className="p-0">
            <SheetTitle className="text-xl">{title}</SheetTitle>
            <SheetDescription className="sr-only">{title}</SheetDescription>
          </SheetHeader>
          {children}
        </SheetContent>
      </UiSheet>
    );
  }
  return (
    <Dialog open onOpenChange={change}>
      <DialogContent className="gap-6 p-8 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-xl">{title}</DialogTitle>
          <DialogDescription className="sr-only">{title}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
