import { cn } from '@/lib/utils';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-md', className)} aria-hidden />;
}

export function PageSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading">
      <Skeleton className="h-7 w-48" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action, className }: { icon?: React.ComponentType<{ className?: string }>; title: string; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      {Icon && (
        <div className="mb-3 rounded-full border border-border bg-surface-muted p-2.5 text-subtle">
          <Icon className="size-5" />
        </div>
      )}
      <p className="font-medium">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-subtle">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; eyebrow?: React.ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs text-subtle">{eyebrow}</div>}
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-subtle">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Notice({ tone = 'info', title, children, className, icon: Icon }: { tone?: 'info' | 'warning' | 'danger' | 'neutral' | 'success'; title?: React.ReactNode; children?: React.ReactNode; className?: string; icon?: React.ComponentType<{ className?: string }> }) {
  const tones = {
    info: 'border-info/25 bg-info-soft',
    warning: 'border-warning/30 bg-warning-soft',
    danger: 'border-danger/30 bg-danger-soft',
    success: 'border-success/25 bg-success-soft',
    neutral: 'border-border bg-surface-muted',
  };
  const iconTone = { info: 'text-info', warning: 'text-warning', danger: 'text-danger', success: 'text-success', neutral: 'text-subtle' };
  return (
    <div className={cn('flex gap-2.5 rounded-lg border px-3.5 py-3 text-sm', tones[tone], className)}>
      {Icon && <Icon className={cn('mt-0.5 size-4 shrink-0', iconTone[tone])} />}
      <div className="min-w-0 space-y-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className="text-muted [&_a]:underline">{children}</div>}
      </div>
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-border bg-surface-muted px-1.5 font-mono text-[10px] text-subtle">{children}</kbd>;
}

export function DefinitionList({ items, className }: { items: { label: string; value: React.ReactNode }[]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2', className)}>
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs text-subtle">{item.label}</dt>
          <dd className="mt-0.5 break-words text-sm">{item.value ?? <span className="text-subtle">Unknown</span>}</dd>
        </div>
      ))}
    </dl>
  );
}
