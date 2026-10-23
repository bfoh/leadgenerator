import type { OpportunityReport } from '@/lib/domain/types';
import { Badge } from '@/components/ui/badge';

export const GENERATOR_LABELS = { deterministic: 'Rule-based', ai: 'AI-assisted', manual_edit: 'Edited' } as const;

export function GeneratorBadge({ report }: { report: Pick<OpportunityReport, 'generator' | 'model'> }) {
  return (
    <Badge tone={report.generator === 'ai' ? 'info' : report.generator === 'manual_edit' ? 'accent' : 'neutral'} title={report.model ?? undefined}>
      {GENERATOR_LABELS[report.generator]}
    </Badge>
  );
}
