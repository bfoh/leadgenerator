'use client';

import { DropdownMenu as M } from 'radix-ui';
import { cn } from '@/lib/utils';

export const Menu = M.Root;
export const MenuTrigger = M.Trigger;

export function MenuContent({ children, align = 'end', className }: { children: React.ReactNode; align?: 'start' | 'end' | 'center'; className?: string }) {
  return (
    <M.Portal>
      <M.Content
        align={align}
        sideOffset={4}
        className={cn('z-50 max-h-[70vh] min-w-44 overflow-y-auto rounded-lg border border-border bg-surface p-1 text-sm shadow-xl', className)}
      >
        {children}
      </M.Content>
    </M.Portal>
  );
}

export function MenuItem({ children, onSelect, disabled, danger, title }: { children: React.ReactNode; onSelect?: () => void; disabled?: boolean; danger?: boolean; title?: string }) {
  return (
    <M.Item
      onSelect={onSelect}
      disabled={disabled}
      title={title}
      className={cn(
        'flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 outline-none data-[disabled]:opacity-45 data-[highlighted]:bg-surface-hover [&_svg]:size-3.5 [&_svg]:text-subtle',
        danger && 'text-danger',
      )}
    >
      {children}
    </M.Item>
  );
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <M.Label className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-subtle">{children}</M.Label>;
}

export function MenuSeparator() {
  return <M.Separator className="my-1 h-px bg-border" />;
}
