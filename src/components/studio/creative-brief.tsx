'use client';

import { AlertTriangle, Check, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Notice } from '@/components/ui/misc';
import {
  BRIEF_BASES,
  BRIEF_BASIS_META,
  BRIEF_SECTION_KEYS,
  BRIEF_SECTION_LABELS,
  briefSummary,
  type BriefBasis,
  type BriefPreferences,
  type CreativeBriefContent,
  type StudioCreativeBrief,
  type StudioCreativeBriefReview,
} from '@/lib/domain/creative-direction';
import { fontById } from '@/lib/domain/font-catalogue';
import { formatDateTime } from '@/lib/utils';
import { AdjustBriefDialog, ConfirmBriefDialog } from './creative-dialogs';

const basisMeta = (basis: string) =>
  (BRIEF_BASES as readonly string[]).includes(basis) ? BRIEF_BASIS_META[basis as BriefBasis] : BRIEF_BASIS_META.creative_suggestion;

function BasisBadge({ basis }: { basis: string }) {
  const meta = basisMeta(basis);
  return <Badge tone={meta.tone} title={meta.description}>{meta.label}</Badge>;
}

function EvidenceLines({ evidence }: { evidence: CreativeBriefContent['sections'][keyof CreativeBriefContent['sections']]['assertions'][number]['evidence'] }) {
  const parts = [
    evidence.observationIds.length ? `${evidence.observationIds.length} observation${evidence.observationIds.length === 1 ? '' : 's'}` : null,
    evidence.assetIds.length ? `${evidence.assetIds.length} approved file${evidence.assetIds.length === 1 ? '' : 's'}` : null,
    evidence.brandKitVersion ? `Brand Kit v${evidence.brandKitVersion}` : null,
    evidence.record.length ? evidence.record.join(', ') : null,
  ].filter(Boolean);
  if (!parts.length && !evidence.note) return null;
  return (
    <p className="mt-1 text-xs text-subtle" title={[...evidence.observationIds, ...evidence.assetIds].join(', ')}>
      {parts.join(' · ')}
      {evidence.note ? `${parts.length ? ' — ' : ''}${evidence.note}` : ''}
    </p>
  );
}

/** The Creative Direction Brief: every claim visibly classified, with the questions still open. */
export function CreativeBriefPanel({
  brief,
  confirmation,
  editable,
  busy,
  onConfirm,
  onAdjust,
}: {
  brief: StudioCreativeBrief;
  confirmation: StudioCreativeBriefReview | null;
  editable: boolean;
  busy: boolean;
  onConfirm: (note: string) => Promise<boolean>;
  onAdjust: (preferences: BriefPreferences, note: string) => Promise<boolean>;
}) {
  const [verdict, setVerdict] = useState<'confirm' | 'adjust' | null>(null);
  const content = brief.content;
  const display = fontById(content.typography.displayFontId);
  const body = fontById(content.typography.bodyFontId);
  const allAssertions = BRIEF_SECTION_KEYS.flatMap((key) => content.sections[key]?.assertions ?? []);
  const confirmed = Boolean(confirmation);

  return (
    <>
      <Card>
        <CardHeader
          title={
            <span className="flex flex-wrap items-center gap-2">
              Creative Direction Brief
              <Badge tone={confirmed ? 'success' : 'warning'}>Version {brief.version}</Badge>
              {confirmed ? <Badge tone="success" dot>Confirmed</Badge> : <Badge tone="warning">Needs confirmation</Badge>}
            </span>
          }
          description={`${briefSummary(content)}. Saved ${formatDateTime(brief.createdAt)}${brief.note ? ` — “${brief.note}”` : ''}.`}
          actions={
            editable ? (
              <>
                <Button size="sm" onClick={() => setVerdict('adjust')} disabled={busy}>
                  <Pencil aria-hidden /> Adjust preferences
                </Button>
                {!confirmed && (
                  <Button size="sm" variant="primary" onClick={() => setVerdict('confirm')} disabled={busy}>
                    <Check aria-hidden /> Confirm brief
                  </Button>
                )}
              </>
            ) : undefined
          }
        />
        <CardBody className="space-y-4">
          <div className="flex flex-wrap gap-1.5">
            {BRIEF_BASES.filter((basis) => allAssertions.some((assertion) => assertion.basis === basis)).map((basis) => (
              <Badge key={basis} tone={BRIEF_BASIS_META[basis].tone}>
                {BRIEF_BASIS_META[basis].label} · {allAssertions.filter((assertion) => assertion.basis === basis).length}
              </Badge>
            ))}
          </div>
          <Notice tone="info" title="What is verified, and what is ours">
            A verified fact was read from the business’s page; a business record came from the workspace; approved Brand Kit content and approved files were signed off by a person. Everything labelled a creative suggestion is the Studio’s proposal, not a fact about the business. Open questions stay questions.
          </Notice>
          {confirmed && confirmation && (
            <p className="text-xs text-subtle">Confirmed {formatDateTime(confirmation.createdAt)} — “{confirmation.note}”</p>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Typography specimen"
            description={display && body ? `${display.family} / ${body.family} — ${display.licence.name}. The Studio does not load or redistribute the font files.` : 'Typefaces are missing from the brief.'}
          />
          <CardBody className="space-y-3">
            <div className="rounded-md border border-border bg-surface-muted p-4">
              <p className="text-[10px] uppercase tracking-[0.16em] text-subtle">Display</p>
              <p className="mt-1 text-2xl leading-tight" style={{ fontFamily: display ? `"${display.family}", Georgia, serif` : undefined }}>
                {display?.family ?? content.typography.displayFamily}
              </p>
              <p className="mt-2 text-lg">
                <span style={{ fontFamily: body ? `"${body.family}", -apple-system, sans-serif` : undefined }}>
                  {content.business.name} — Aa Bb Cc ɛ ɔ
                </span>
              </p>
              <p className="mt-2 text-xs text-subtle">Specimen shown in the local fallback stack. The licensed files are self-hosted in the build, not in the Studio.</p>
            </div>
            <p className="text-sm text-muted">{content.typography.rationale}</p>
            <div className="flex flex-wrap gap-1.5">
              {content.typography.licences.map((licence) => (
                <Badge key={licence} tone="success">{licence}</Badge>
              ))}
              {content.languages.map((language) => (
                <Badge key={language} tone="neutral">{language}</Badge>
              ))}
            </div>
            <p className="text-xs text-subtle">Scale: {content.typography.scale.scaleNote} Body measure: {content.typography.scale.bodyMeasure}.</p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Colour and contrast" description="A palette with roles, measured against WCAG AA. Any pair that fails is a blocker, not a taste question." />
          <CardBody className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {content.colour.palette.map((entry) => (
                <div key={`${entry.role}-${entry.hex}`} className="rounded-md border border-border p-2">
                  <span className="block h-10 rounded border border-border" style={{ background: entry.hex }} aria-hidden />
                  <p className="mt-1 truncate text-xs font-medium">{entry.name}</p>
                  <p className="text-xs text-subtle">{entry.hex} · {entry.role.replace(/_/g, ' ')}</p>
                </div>
              ))}
            </div>
            <ul className="space-y-1 text-xs text-subtle">
              {content.colour.contrast.map((check) => (
                <li key={check.usage} className="flex flex-wrap items-center gap-2">
                  <Badge tone={check.passesAA ? 'success' : 'danger'}>{check.ratio}:1</Badge>
                  <span>{check.usage}</span>
                </li>
              ))}
            </ul>
            <p className="text-sm text-muted">{content.colour.notes}</p>
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {BRIEF_SECTION_KEYS.map((key) => {
          const section = content.sections[key];
          if (!section) return null;
          return (
            <Card key={key}>
              <CardHeader title={BRIEF_SECTION_LABELS[key]} description={section.summary} as="h3" />
              <CardBody>
                <ul className="space-y-3">
                  {section.assertions.map((assertion) => (
                    <li key={assertion.id} className="border-l-2 border-border pl-3">
                      <div className="flex flex-wrap items-start gap-2">
                        <BasisBadge basis={assertion.basis} />
                        <p className="min-w-0 flex-1 text-sm">{assertion.text}</p>
                      </div>
                      <EvidenceLines evidence={assertion.evidence} />
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Missing information" description="Questions for the business. A blocking question stops the brief from being treated as final; it is never filled with an assumption." />
          <CardBody>
            <ul className="space-y-3">
              {content.missingInformation.map((item) => (
                <li key={item.id} className="flex gap-2">
                  <AlertTriangle className={item.blocking ? 'mt-0.5 size-4 shrink-0 text-warning' : 'mt-0.5 size-4 shrink-0 text-subtle'} aria-hidden />
                  <div className="min-w-0">
                    <p className="text-sm">
                      {item.question} {item.blocking && <Badge tone="warning">Blocking</Badge>}
                    </p>
                    <p className="text-xs text-subtle">{item.why}</p>
                  </div>
                </li>
              ))}
              {content.missingInformation.length === 0 && <li className="text-sm text-subtle">No open questions recorded.</li>}
            </ul>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Client confirmations" description="What the business must confirm before publication. The Studio does not answer these on the client’s behalf." />
          <CardBody>
            <ul className="space-y-3">
              {content.confirmations.map((item) => (
                <li key={item.id}>
                  <p className="text-sm">
                    {item.item} {item.required ? <Badge tone="warning">Required</Badge> : <Badge tone="neutral">Recommended</Badge>}
                  </p>
                  <p className="text-xs text-subtle">{item.why}</p>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>

      {verdict === 'confirm' && <ConfirmBriefDialog brief={brief} pending={busy} onClose={() => setVerdict(null)} onSubmit={onConfirm} />}
      {verdict === 'adjust' && <AdjustBriefDialog content={content} pending={busy} onClose={() => setVerdict(null)} onSubmit={onAdjust} />}
    </>
  );
}


