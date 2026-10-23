import Link from 'next/link';
import type { ProposalBasis } from '@/lib/domain/proposal';
import { formatDateTime } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';

/** Internal provenance of a draft: never part of the client document. */
export function ProposalBasisCard({ basis }: { basis: ProposalBasis }) {
  const included = basis.addOns.filter((a) => a.included);
  const offered = basis.addOns.filter((a) => !a.included);
  return (
    <Card data-testid="proposal-basis">
      <CardHeader
        title="How this draft was prepared"
        as="h3"
        description={`${basis.source === 'agent' ? 'Proposal Generation agent' : 'Created by a person'} · ${basis.template} template · ${formatDateTime(basis.preparedAt)}. Internal only; not printed.`}
      />
      <CardBody className="space-y-3 text-sm">
        {basis.packageKey !== basis.recommendedPackageKey && <Badge tone="warning">Package differs from the recommendation</Badge>}
        <div>
          <p className="text-xs font-medium text-muted">Why this package</p>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-[13px]">
            {basis.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
        {basis.addOns.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted">Add-ons from your price list</p>
            <ul className="mt-1 space-y-1 text-[13px]">
              {[...included, ...offered].map((a) => (
                <li key={a.key}>
                  <span className="font-medium">{a.name}</span> <span className="text-subtle">· {a.included ? 'in scope' : 'optional'}{a.priced ? '' : ' · not priced yet'}</span>
                  <span className="block text-xs text-subtle">{a.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {basis.missingAddOns.length > 0 && (
          <p className="text-xs text-warning">
            Not in your price list, so left out: {basis.missingAddOns.join(', ')}. Add them in{' '}
            <Link href="/settings?tab=packages" className="underline">
              Settings → Packages
            </Link>
            .
          </p>
        )}
        {basis.unmatchedNeeds.length > 0 && <p className="text-xs text-subtle">Recorded needs to scope in discovery: {basis.unmatchedNeeds.join('; ')}</p>}
        <p className="text-xs text-subtle">
          {basis.reportId ? (
            <>
              Based on{' '}
              <Link href={`/reports/${basis.reportId}`} className="underline">
                report v{basis.reportVersion}
              </Link>
              {basis.reportConfidence ? ` (${basis.reportConfidence} confidence)` : ''}.
            </>
          ) : (
            'No report was used.'
          )}{' '}
          Prices come only from your packages and price list. Generator {basis.generator}.
        </p>
      </CardBody>
    </Card>
  );
}
