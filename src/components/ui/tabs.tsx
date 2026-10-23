'use client';

import { Tabs as T } from 'radix-ui';
import { cn } from '@/lib/utils';

export const Tabs = T.Root;
export const TabsContent = T.Content;

export function TabsList({ className, children, label }: { className?: string; children: React.ReactNode; label: string }) {
  return (
    <T.List aria-label={label} className={cn('-mb-px flex gap-1 overflow-x-auto border-b border-border [scrollbar-width:none]', className)}>
      {children}
    </T.List>
  );
}

export function TabsTrigger({ value, children, count }: { value: string; children: React.ReactNode; count?: number }) {
  return (
    <T.Trigger
      value={value}
      className="inline-flex shrink-0 items-center gap-1.5 border-b-2 border-transparent px-2.5 py-2 text-sm font-medium text-subtle transition-colors hover:text-foreground data-[state=active]:border-accent data-[state=active]:text-foreground"
    >
      {children}
      {count != null && <span className="rounded-full bg-surface-muted px-1.5 text-[11px] tabular text-muted">{count}</span>}
    </T.Trigger>
  );
}
