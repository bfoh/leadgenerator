'use client';

import { X } from 'lucide-react';
import { Dialog as D } from 'radix-ui';
import { cn } from '@/lib/utils';

// Recently focused elements, newest last. Dialogs here open from state rather than a Radix trigger,
// and a field with autoFocus can take focus before Radix notices the dialog opened, so Radix has
// nothing to return focus to on close. On close, focus goes back to the newest element that is still
// on the page: the closed dialog's own elements are gone by then, so that is what opened it (WCAG 2.4.3).
const history: HTMLElement[] = [];
if (typeof document !== 'undefined') {
  document.addEventListener(
    'focusin',
    (e) => {
      if (!(e.target instanceof HTMLElement) || e.target === document.body) return;
      history.push(e.target);
      if (history.length > 30) history.shift();
    },
    true,
  );
}

function restoreFocus(e: Event) {
  const el = [...history].reverse().find((h) => h.isConnected && !h.closest('[inert]'));
  if (!el) return;
  e.preventDefault();
  el.focus();
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
  side,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Render as a side sheet instead of a centred dialog. */
  side?: 'right';
}) {
  const width = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size];
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-[var(--overlay)]" />
        <D.Content
          onCloseAutoFocus={restoreFocus}
          className={cn(
            'fixed z-50 flex flex-col border border-border bg-surface shadow-2xl focus:outline-none',
            side === 'right'
              ? cn('inset-y-0 right-0 w-full', width, 'sm:rounded-l-xl')
              : cn('inset-x-0 bottom-0 max-h-[92dvh] rounded-t-xl sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-[8vh] sm:max-h-[84vh] sm:w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:rounded-xl', width),
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <D.Title className="text-base font-semibold">{title}</D.Title>
              {description ? <D.Description className="mt-1 text-sm text-subtle">{description}</D.Description> : <D.Description className="sr-only">{typeof title === 'string' ? title : 'Dialog'}</D.Description>}
            </div>
            <D.Close className="-mr-1 rounded-md p-1 text-subtle hover:bg-surface-hover hover:text-foreground" aria-label="Close">
              <X className="size-4" />
            </D.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
