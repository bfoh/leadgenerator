import { LINE_ITEM_KIND_LABELS } from '@/lib/domain/packages';
import { computeTotals, formatMoney, type ProposalContent } from '@/lib/domain/proposal';
import type { ProposalStatus } from '@/lib/domain/constants';
import type { AgencyProfile } from '@/lib/domain/settings';
import { formatDate } from '@/lib/utils';

function List({ items }: { items: string[] }) {
  const clean = items.filter((i) => i.trim());
  if (!clean.length) return <p className="text-subtle">None.</p>;
  return (
    <ul className="list-disc space-y-1 pl-5">
      {clean.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 break-inside-avoid-page">
      <h2 className="border-l-[3px] border-[color:var(--brand,var(--color-border))] pl-2.5 text-base font-semibold">
        <span className="mr-2 font-sans text-xs text-subtle tabular">{String(n).padStart(2, '0')}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export type ProposalBrand = Pick<AgencyProfile, 'name' | 'email' | 'phone' | 'website' | 'address' | 'accentColor' | 'logoDataUrl'>;

/**
 * Client-facing proposal rendering, shared by the preview, version history and print view. The
 * agency's branding (Settings → Agency) is presentation only; the accent colour is used for rules
 * and bands, never for text, so any colour stays readable.
 */
export function ProposalDocument({ title, status, content, currency = 'GHS', brand }: { title: string; status: ProposalStatus; content: ProposalContent; currency?: string; brand?: ProposalBrand }) {
  const t = computeTotals(content);
  const money = (n: number | null) => formatMoney(n, currency);
  const milestoneTotal = content.milestones.reduce((s, m) => s + m.percent, 0);
  const contact = brand ? [brand.email, brand.phone, brand.website, brand.address].filter((x) => x.trim()) : [];
  const agencyName = content.preparedBy || brand?.name || '';
  return (
    <article className="doc space-y-7 text-[15px]" style={brand?.accentColor ? ({ '--brand': brand.accentColor } as React.CSSProperties) : undefined} data-testid="proposal-document">
      {status === 'draft' && (
        <p className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 font-sans text-xs font-medium text-warning">DRAFT — not approved for sending</p>
      )}
      {(brand?.logoDataUrl || agencyName) && (
        <div className="flex items-center justify-between gap-4 border-t-4 border-[color:var(--brand,var(--color-border))] pt-4 font-sans">
          {brand?.logoDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a data URL from settings, not an optimisable asset
            <img src={brand.logoDataUrl} alt={agencyName ? `${agencyName} logo` : 'Agency logo'} className="h-12 w-auto max-w-48 object-contain" />
          ) : (
            <span className="text-base font-semibold tracking-tight">{agencyName}</span>
          )}
          {contact.length > 0 && (
            <p className="text-right text-xs leading-relaxed text-subtle">
              {contact.map((c) => (
                <span key={c} className="block break-all">
                  {c}
                </span>
              ))}
            </p>
          )}
        </div>
      )}
      <header className="space-y-3 border-b border-border pb-6">
        <p className="font-sans text-xs uppercase tracking-wide text-subtle">Proposal</p>
        <h1 className="text-2xl font-semibold leading-tight">{title}</h1>
        <dl className="grid gap-x-6 gap-y-1 font-sans text-sm sm:grid-cols-2">
          <div>
            <dt className="inline text-subtle">Prepared for: </dt>
            <dd className="inline">{content.preparedFor}</dd>
          </div>
          <div>
            <dt className="inline text-subtle">Prepared by: </dt>
            <dd className="inline">{content.preparedBy || '[Agency name]'}</dd>
          </div>
          <div>
            <dt className="inline text-subtle">Date: </dt>
            <dd className="inline">{formatDate(content.preparedOn)}</dd>
          </div>
          {content.validUntil && (
            <div>
              <dt className="inline text-subtle">Valid until: </dt>
              <dd className="inline">{formatDate(content.validUntil)}</dd>
            </div>
          )}
        </dl>
      </header>

      <Section n={1} title="Executive summary">
        <p className="whitespace-pre-wrap">{content.executiveSummary}</p>
      </Section>
      <Section n={2} title="Current situation">
        <p className="whitespace-pre-wrap">{content.currentSituation}</p>
      </Section>
      <Section n={3} title="Identified opportunities">
        <List items={content.opportunities} />
      </Section>
      <Section n={4} title="Recommended solution">
        <p className="whitespace-pre-wrap">{content.recommendedSolution}</p>
      </Section>
      <Section n={5} title="Deliverables">
        <List items={content.deliverables} />
      </Section>
      <Section n={6} title="Scope exclusions">
        <List items={content.exclusions} />
      </Section>
      <Section n={7} title="Project phases">
        <ol className="space-y-2">
          {content.phases.map((p, i) => (
            <li key={i}>
              <strong className="font-sans text-sm">{p.name}</strong>
              {p.duration && <span className="font-sans text-xs text-subtle"> · {p.duration}</span>}
              <p>{p.description}</p>
            </li>
          ))}
        </ol>
      </Section>
      <Section n={8} title="Timeline">
        <p className="whitespace-pre-wrap">{content.timeline}</p>
      </Section>
      <Section n={9} title="Quotation">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] font-sans text-sm">
            <thead className="border-b-2 border-[color:var(--brand,var(--color-border))] text-left text-xs text-subtle">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">Item</th>
                <th scope="col" className="py-2 pr-3 font-medium">Type</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">Qty</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">Unit price</th>
                <th scope="col" className="py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {content.lineItems.map((l) => (
                <tr key={l.id}>
                  <td className="py-2 pr-3">{l.description}</td>
                  <td className="py-2 pr-3 text-subtle">{LINE_ITEM_KIND_LABELS[l.kind]}</td>
                  <td className="py-2 pr-3 text-right tabular">{l.quantity}</td>
                  <td className="py-2 pr-3 text-right tabular">{money(l.unitPrice)}</td>
                  <td className="py-2 text-right tabular">{l.unitPrice == null ? 'To be quoted' : money(l.quantity * l.unitPrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="ml-auto mt-3 max-w-xs space-y-1 font-sans text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-subtle">One-time subtotal</dt>
            <dd className="tabular">{money(t.oneTimeSubtotal)}</dd>
          </div>
          {t.taxLines.map((x) => (
            <div key={x.label} className="flex justify-between gap-4">
              <dt className="text-subtle">
                {x.label} ({x.ratePercent}%)
              </dt>
              <dd className="tabular">{money(x.oneTime)}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-4 border-t border-border pt-1 font-semibold">
            <dt>One-time total</dt>
            <dd className="tabular">{money(t.oneTimeTotal)}</dd>
          </div>
          {t.monthlySubtotal > 0 && (
            <div className="flex justify-between gap-4">
              <dt className="text-subtle">Monthly{t.taxLines.length ? ' (incl. tax)' : ''}</dt>
              <dd className="tabular">{money(t.monthlyTotal)} / month</dd>
            </div>
          )}
          {t.annualSubtotal > 0 && (
            <div className="flex justify-between gap-4">
              <dt className="text-subtle">Annual{t.taxLines.length ? ' (incl. tax)' : ''}</dt>
              <dd className="tabular">{money(t.annualTotal)} / year</dd>
            </div>
          )}
          {t.optionalSubtotal > 0 && (
            <div className="flex justify-between gap-4 text-subtle">
              <dt>Optional items (not included)</dt>
              <dd className="tabular">{money(t.optionalSubtotal)}</dd>
            </div>
          )}
        </dl>
        {t.unpricedRequired > 0 && <p className="font-sans text-xs text-warning">{t.unpricedRequired} item(s) still to be quoted.</p>}
      </Section>
      <Section n={10} title="Payment milestones">
        <ul className="space-y-1">
          {content.milestones.map((m) => (
            <li key={m.id}>
              <strong className="font-sans text-sm">{m.label}</strong> — {m.percent}%{m.trigger ? `, ${m.trigger.charAt(0).toLowerCase()}${m.trigger.slice(1)}` : ''}
              {t.oneTimeTotal > 0 && <span className="font-sans text-xs text-subtle"> ({money(Math.round(t.oneTimeTotal * m.percent) / 100)})</span>}
            </li>
          ))}
        </ul>
        {content.milestones.length > 0 && Math.abs(milestoneTotal - 100) > 0.01 && <p className="font-sans text-xs text-danger">Milestones total {milestoneTotal}% — must equal 100%.</p>}
      </Section>
      <Section n={11} title="Maintenance terms">
        <p className="whitespace-pre-wrap">{content.maintenanceTerms}</p>
      </Section>
      <Section n={12} title="Client responsibilities">
        <List items={content.clientResponsibilities} />
      </Section>
      <Section n={13} title="Assumptions">
        <List items={content.assumptions} />
      </Section>
      <Section n={14} title="Next steps">
        <List items={content.nextSteps} />
      </Section>
      <footer className="border-t border-border pt-4 font-sans text-xs text-subtle">
        <p>
          {agencyName ? `Prepared by ${agencyName}. ` : ''}Prices are in {currency === 'GHS' ? 'Ghana cedis (GH₵)' : currency}
          {content.validUntil ? ` and valid until ${formatDate(content.validUntil)}` : ''}. Items marked “To be quoted” are confirmed before any commitment. This proposal becomes binding only
          when both parties agree the final terms in writing.
        </p>
      </footer>
    </article>
  );
}
