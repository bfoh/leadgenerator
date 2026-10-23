'use client';

import { FileText, Sparkles, Wand2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { buildEvidencePack } from '@/lib/domain/evidence';
import { NEXT_ACTION_META, reportReadiness } from '@/lib/domain/report';
import type { Business } from '@/lib/domain/types';
import { formatDateTime } from '@/lib/utils';
import { useServerStatus } from '@/lib/workspace/api';
import { useAction, useReports, useVerifications } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { generateAiReport, generateRuleBasedReport } from '@/components/reports/generate';
import { GeneratorBadge } from '@/components/reports/report-meta';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState, Notice } from '@/components/ui/misc';

export function ReportsTab({ business }: { business: Business }) {
  const { can, settings } = useWorkspace();
  const { data: verifications } = useVerifications(business.id);
  const readiness = verifications ? reportReadiness(buildEvidencePack(business, verifications), settings.reportMinConfidence) : null;
  const router = useRouter();
  const status = useServerStatus();
  const { data: reports = [] } = useReports(business.id);
  const open = (id: string) => router.push(`/reports/${id}`);
  const rule = useAction(generateRuleBasedReport, { success: (r) => `Report v${r.version} saved`, onSuccess: (r) => open(r.id) });
  const ai = useAction(generateAiReport, { success: (r) => `AI report v${r.version} saved`, onSuccess: (r) => open(r.id) });
  const aiReady = Boolean(status.data?.ai.configured && status.data.serverTools);
  const sorted = [...reports].sort((a, b) => b.version - a.version);

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        <CardHeader title="Opportunity reports" description="Each generation or edit is saved as a new version with its evidence snapshot. The Opportunity Report agent writes one automatically once research is complete." />
        {sorted.length === 0 ? (
          <EmptyState icon={FileText} title="No reports yet" description="Generate one from the recorded evidence." />
        ) : (
          <ul className="divide-y divide-border">
            {sorted.map((r) => (
              <li key={r.id}>
                <Link href={`/reports/${r.id}`} className="flex flex-wrap items-center gap-2 px-4 py-3 hover:bg-surface-hover/60">
                  <span className="font-medium">Version {r.version}</span>
                  <GeneratorBadge report={r} />
                  {(r.validation?.warnings.length ?? 0) > 0 && <Badge tone="warning">{r.validation!.warnings.length} warning(s)</Badge>}
                  <span className="text-xs text-subtle">Next: {NEXT_ACTION_META[r.content.nextAction.action].label.toLowerCase()}</span>
                  <span className="ml-auto text-xs text-subtle">{formatDateTime(r.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <div className="space-y-5">
        {can('reports.write') && (
          <Card>
            <CardHeader title="Generate" as="h3" />
            <CardBody className="space-y-3">
              {readiness && !readiness.ready && (
                <Notice tone="warning" title="Research is not complete enough for an automatic report">
                  <ul className="list-disc pl-4">
                    {readiness.missing.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                  <p className="mt-1">You can still write one now; it will list these gaps as limitations.</p>
                </Notice>
              )}
              <Button className="w-full justify-center" onClick={() => rule.run(business)} loading={rule.pending} disabled={ai.pending}>
                <Wand2 /> Rule-based report
              </Button>
              <p className="text-xs text-subtle">Built from stored evidence and sector guidance. Free, instant and deterministic.</p>
              <Button variant="primary" className="w-full justify-center" onClick={() => ai.run(business)} loading={ai.pending} disabled={!aiReady || rule.pending}>
                <Sparkles /> AI-assisted report
              </Button>
              <p className="text-xs text-subtle">
                {aiReady
                  ? `Uses ${status.data?.ai.model} (checked before each call). Every fact must cite evidence; unsupported statements are removed. Usage is metered.`
                  : 'Needs ANTHROPIC_API_KEY on the server (and sign-in or DEMO_SERVER_TOOLS). The rule-based report works without it.'}
              </p>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}
