'use client';

import { useQuery } from '@tanstack/react-query';
import { loadMeetingBrief } from '@/lib/data/response-services';
import type { Business } from '@/lib/domain/types';
import { formatDate, formatDateTime } from '@/lib/utils';
import { useBusiness } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { PrintToolbar } from '@/components/records/print-toolbar';
import { PageSkeleton } from '@/components/ui/misc';

export function MeetingPrint({ businessId }: { businessId: string }) {
  const { data: business, isLoading } = useBusiness(businessId);
  if (isLoading) return <PageSkeleton />;
  if (!business) return <p>Prospect not found.</p>;
  return <Brief business={business} />;
}

function Brief({ business }: { business: Business }) {
  const { ctx, workspace } = useWorkspace();
  const { data: brief, isLoading, error } = useQuery({ queryKey: [workspace.organizationId, 'meeting-brief', business.id], queryFn: () => loadMeetingBrief(ctx, business) });
  if (isLoading) return <PageSkeleton />;
  if (error || !brief) return <p>The meeting brief could not be prepared. {error instanceof Error ? error.message : ''}</p>;
  return (
    <>
      <PrintToolbar note="Internal document for your team. Do not share it with the business." />
      <article className="space-y-6 text-sm leading-6" data-testid="meeting-brief">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">{brief.title}</h1>
          <p className="text-xs text-subtle">Prepared {formatDateTime(brief.generatedAt)} from the records in this workspace. Internal.</p>
        </header>

        <section>
          <h2 className="mb-2 text-base font-semibold">Overview</h2>
          <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[max-content_1fr]">
            {brief.overview.map((o) => (
              <div key={o.label} className="contents">
                <dt className="font-medium text-muted">{o.label}</dt>
                <dd>{o.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold">What the records support</h2>
          {brief.known.length === 0 ? (
            <p className="text-subtle">No report statements with evidence yet. Treat everything as a question.</p>
          ) : (
            <ul className="list-disc space-y-1 pl-5">
              {brief.known.map((k) => (
                <li key={k.text}>
                  {k.text} <span className="text-xs text-subtle">({k.evidence.join(', ')})</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2">
            <span className="font-medium">Website: </span>
            {brief.website}
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold">Conversation so far</h2>
          {brief.conversation.length === 0 ? (
            <p className="text-subtle">No replies recorded.</p>
          ) : (
            <ul className="space-y-1">
              {brief.conversation.map((c, i) => (
                <li key={`${c.at}-${i}`}>
                  <span className="text-xs text-subtle">
                    {formatDateTime(c.at)} · {c.channel}
                  </span>{' '}
                  · <span className="font-medium">{c.intent}</span>
                  {c.summary ? ` — ${c.summary}` : ''}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold">Proposal</h2>
          {brief.proposal ? (
            <p>
              {brief.proposal.title} · {brief.proposal.status}
              {brief.proposal.total ? ` · ${brief.proposal.total} one-time` : ' · not priced for the client yet (draft)'}
              {brief.proposal.validUntil ? ` · valid until ${formatDate(brief.proposal.validUntil)}` : ''}
              {brief.proposal.openChanges ? ` · ${brief.proposal.openChanges} open change request${brief.proposal.openChanges === 1 ? '' : 's'}` : ''}
            </p>
          ) : (
            <p className="text-subtle">No proposal yet.</p>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold">Questions to ask</h2>
          <ul className="list-disc space-y-1 pl-5">
            {brief.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold">Agenda</h2>
          <ol className="list-decimal space-y-1 pl-5">
            {brief.agenda.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ol>
        </section>

        <section className="rounded-md border border-border p-3">
          <h2 className="mb-2 text-base font-semibold">Do not</h2>
          <ul className="list-disc space-y-1 pl-5">
            {brief.cautions.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </section>
      </article>
    </>
  );
}
