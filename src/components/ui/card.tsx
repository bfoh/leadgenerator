import { cn } from '@/lib/utils';

export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-lg border border-border bg-surface', className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ title, description, actions, className, as: As = 'h2' }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string; as?: 'h2' | 'h3' }) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3', className)}>
      <div className="min-w-0">
        <As className="text-sm font-semibold">{title}</As>
        {description && <p className="mt-0.5 text-xs text-subtle">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('p-4', className)}>{children}</div>;
}
