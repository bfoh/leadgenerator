import type { EvidencePack } from '@/lib/domain/evidence';
import {
  NEXT_ACTION_META,
  REPORT_SECTIONS,
  STATEMENT_KIND_META,
  type ConfidenceLevel,
  type ReportContent,
  type ReportSection,
  type ReportStatement,
} from '@/lib/domain/report';
import type { OpportunityReport } from '@/lib/domain/types';
import { formatDate, safeHref } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { GENERATOR_LABELS } from './report-meta';

const PRIORITY_LABEL = { primary: 'Primary', secondary: 'Secondary', future: 'Future' } as const;
const LEVEL_TONE = { high: 'success', medium: 'info', low: 'warning', unknown: 'neutral' } as const satisfies Record<ConfidenceLevel, string>;
const LEVEL_LABEL: Record<ConfidenceLevel, string> = { high: 'High', medium: 'Medium', low: 'Low', unknown: 'Unknown' };

function Cite({ ids }: { ids: string[] }) {
  if (!ids.length) return null;
  return (
    <span className="ml-1 inline-flex flex-wrap gap-1 align-baseline font-sans">
      {ids.map((id) => (
        <a key={id} href={`#evidence-${id}`} className="rounded bg-surface-muted px-1 text-[10px] font-medium text-muted no-underline hover:text-foreground" aria-label={`Evidence ${id}`}>
          {id}
        </a>
      ))}
    </span>
  );
}

function Kind({ kind }: { kind: ReportStatement['kind'] }) {
  const meta = STATEMENT_KIND_META[kind];
  return (
    <Badge tone={meta.tone} title={meta.description} className="mr-1.5 align-[1px] font-sans">
      {meta.label}
    </Badge>
  );
}

function Statements({ list }: { list: ReportStatement[] }) {
  if (!list.length) return null;
  return (
    <ul className="space-y-1.5">
      {list.map((s, i) => (
        <li key={i} data-testid="report-statement" data-kind={s.kind}>
          <Kind kind={s.kind} />
          {s.text}
          <Cite ids={s.evidenceIds} />
        </li>
      ))}
    </ul>
  );
}

function Section({ n, children, kicker }: { n: number; children: React.ReactNode; kicker?: string }) {
  return (
    <section className="space-y-2 break-inside-avoid-page" aria-labelledby={`report-s${n}`}>
      <h2 id={`report-s${n}`} className="text-base font-semibold">
        <span className="font-sans text-sm text-subtle tabular">{n}.</span> {REPORT_SECTIONS[n - 1].title}
      </h2>
      {kicker && <p className="font-sans text-xs text-subtle">{kicker}</p>}
      {children}
    </section>
  );
}

function Narrative({ n, section }: { n: number; section: ReportSection }) {
  return (
    <Section n={n}>
      {section.summary && <p>{section.summary}</p>}
      <Statements list={section.statements} />
    </Section>
  );
}

/** Read-only report rendering used on screen and in the print view. */
export function ReportDocument({ content, pack, report }: { content: ReportContent; pack: EvidencePack; report: Pick<OpportunityReport, 'version' | 'generator' | 'model' | 'createdAt'> }) {
  const cited = new Set(content.evidenceReferences);
  const next = NEXT_ACTION_META[content.nextAction.action];
  return (
    <article className="doc space-y-7 text-[15px]">
      <header className="space-y-2 border-b border-border pb-5">
        <p className="font-sans text-xs uppercase tracking-wide text-subtle">Digital opportunity report</p>
        <h1 className="text-2xl font-semibold">{pack.business.name}</h1>
        <p className="font-sans text-sm text-subtle">
          {pack.business.category} · {[pack.business.neighborhood, pack.business.city].filter(Boolean).join(', ')} · Version {report.version} · {GENERATOR_LABELS[report.generator]}
          {report.model ? ` (${report.model})` : ''} · {formatDate(report.createdAt)}
        </p>
        <p className="font-sans text-xs text-subtle">
          Every statement is labelled. Verified facts and evidence-supported findings cite numbered evidence; recommendations and assumptions are the agency&apos;s judgement, not facts about the business.
        </p>
        {content.convertedFrom && <p className="font-sans text-xs text-warning">Written in the earlier report format and shown here converted. Regenerate for the full twelve-section analysis.</p>}
        <div className="rounded-lg border border-border bg-surface-muted/50 p-3 font-sans" data-testid="report-confidence">
          <p className="text-xs font-medium">
            Confidence: <Badge tone={LEVEL_TONE[content.confidence.overall]}>{LEVEL_LABEL[content.confidence.overall]}</Badge>
            {content.confidence.score != null && <span className="ml-2 text-subtle">research confidence {content.confidence.score}/100</span>}
          </p>
          <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
            {content.confidence.items.map((i) => (
              <div key={i.area} className="flex min-w-0 gap-1.5">
                <dt className="shrink-0 text-subtle">{i.area}:</dt>
                <dd className="min-w-0">
                  <span className="font-medium">{LEVEL_LABEL[i.level]}</span> <span className="text-subtle">— {i.detail}</span>
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-[11px] text-subtle">
            {(Object.keys(STATEMENT_KIND_META) as ReportStatement['kind'][])
              .map((k) => `${content.confidence.statementCounts[k]} ${STATEMENT_KIND_META[k].label.toLowerCase()}${content.confidence.statementCounts[k] === 1 ? '' : 's'}`)
              .join(' · ')}
          </p>
        </div>
      </header>

      <Narrative n={1} section={content.businessOverview} />
      <Narrative n={2} section={content.researchSummary} />
      <Narrative n={3} section={content.websiteFindings} />
      <Narrative n={4} section={content.contactAssessment} />
      <Narrative n={5} section={content.digitalPresence} />

      <Section n={6} kicker="Evidence-supported opportunities cite the audit or verification evidence; the rest are recommendations for this sector.">
        <ul className="space-y-2">
          {content.opportunities.map((o, i) => (
            <li key={i}>
              <strong className="font-sans text-sm">{o.title}</strong> <Kind kind={o.kind} />
              <p>
                {o.description}
                <Cite ids={o.evidenceIds} />
              </p>
            </li>
          ))}
        </ul>
      </Section>

      <Section n={7}>
        {content.recommendedSolution.summary && <p>{content.recommendedSolution.summary}</p>}
        <ul className="space-y-2">
          {content.recommendedSolution.items.map((s, i) => (
            <li key={i}>
              <strong className="font-sans text-sm">{s.service}</strong> <span className="font-sans text-xs text-subtle">· {PRIORITY_LABEL[s.priority]}</span>
              <p>
                {s.rationale}
                <Cite ids={s.evidenceIds} />
              </p>
            </li>
          ))}
        </ul>
        <Statements list={content.recommendedSolution.statements} />
      </Section>

      <Section n={8}>
        <ol className="space-y-3">
          {content.implementationPhases.map((p, i) => (
            <li key={i}>
              <strong className="font-sans text-sm">{p.name}</strong>
              {p.indicativeDuration && <span className="font-sans text-xs text-subtle"> · {p.indicativeDuration}</span>}
              <p>{p.objective}</p>
              {p.deliverables.length > 0 && (
                <ul className="list-disc pl-5 text-[14px]">
                  {p.deliverables.map((d, j) => (
                    <li key={j}>{d}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </Section>

      <Section n={9} kicker="Potential benefits, not forecasts. No revenue or sales figures are estimated or promised.">
        <Statements list={content.expectedBenefits} />
      </Section>

      <Section n={10} kicker="Confirm these before relying on the report.">
        <ul className="space-y-1.5">
          {content.limitations.map((u, i) => (
            <li key={i}>
              {u.item} <span className="font-sans text-xs text-subtle">— {u.howToConfirm}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section n={11} kicker={`Snapshot taken ${formatDate(pack.generatedAt)}. ${cited.size} of ${pack.items.length} items are cited.`}>
        <ol className="space-y-1.5 font-sans text-[13px]">
          {pack.items.map((item) => {
            const href = safeHref(item.source);
            return (
              <li key={item.id} id={`evidence-${item.id}`} className="scroll-mt-20">
                <span className="mr-1.5 font-medium">{item.id}</span>
                {item.statement}
                {item.userSupplied && <span className="ml-1 text-xs text-subtle">(recorded text)</span>}
                {!cited.has(item.id) && <span className="ml-1 text-xs text-subtle">(not cited)</span>}
                {href && (
                  <>
                    {' '}
                    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-xs text-subtle underline">
                      source
                    </a>
                  </>
                )}
              </li>
            );
          })}
        </ol>
      </Section>

      <Section n={12}>
        <p data-testid="report-next-action">
          <strong className="font-sans text-sm">{next.label}.</strong> {content.nextAction.rationale}
        </p>
        <p className="font-sans text-xs text-subtle">Limited to what the research and the recorded permission allow. A report never authorises contacting the business.</p>
      </Section>
    </article>
  );
}
