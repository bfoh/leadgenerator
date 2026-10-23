import type { Tone } from '@/lib/domain/constants';
import { cn } from '@/lib/utils';

const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-muted text-muted border-border',
  accent: 'bg-accent-soft text-accent-strong border-accent/25',
  success: 'bg-success-soft text-success border-success/25',
  warning: 'bg-warning-soft text-warning border-warning/25',
  danger: 'bg-danger-soft text-danger border-danger/25',
  info: 'bg-info-soft text-info border-info/25',
};

const DOTS: Record<Tone, string> = {
  neutral: 'bg-subtle',
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
};

export function Badge({ tone = 'neutral', dot, className, children, title }: { tone?: Tone; dot?: boolean; className?: string; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={cn('inline-flex max-w-full items-center gap-1.5 truncate rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4', TONES[tone], className)}>
      {dot && <span className={cn('size-1.5 shrink-0 rounded-full', DOTS[tone])} aria-hidden />}
      <span className="truncate">{children}</span>
    </span>
  );
}
