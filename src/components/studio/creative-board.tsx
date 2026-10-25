'use client';

import { ExternalLink, Image as ImageIcon, Move } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Notice } from '@/components/ui/misc';
import { paletteEntry, type DesignTokens } from '@/lib/domain/design-tokens';
import type { CreativeConcept } from '@/lib/domain/creative-direction';
import { fontById } from '@/lib/domain/font-catalogue';

const roleHex = (tokens: DesignTokens, role: 'background' | 'surface' | 'text' | 'muted_text' | 'accent' | 'accent_text' | 'support' | 'border') =>
  paletteEntry(tokens.palette, role)?.hex;

function CompositionDiagram({ concept }: { concept: CreativeConcept }) {
  const tokens = concept.tokens;
  const background = roleHex(tokens, 'background') ?? '#FFFFFF';
  const text = roleHex(tokens, 'text') ?? '#111111';
  const accent = roleHex(tokens, 'accent') ?? '#7A1F3D';
  const surface = roleHex(tokens, 'surface') ?? background;
  const border = roleHex(tokens, 'border') ?? text;
  const display = fontById(concept.typography.displayFontId);
  const body = fontById(concept.typography.bodyFontId);
  const family = concept.composition.family;
  const columns = tokens.grid.columns;
  const textSpan = family === 'editorial_columns' ? 'span 7' : family === 'asymmetric_offset' ? '4 / span 7' : family === 'quiet_centered' ? '2 / span 6' : '1 / -1';
  const imageSpan = family === 'editorial_columns' ? '8 / span 5' : family === 'asymmetric_offset' ? '2 / span 5' : family === 'quiet_centered' ? '2 / span 6' : '1 / -1';
  const heroHeight = family === 'cinematic_full_bleed' ? '14rem' : family === 'catalogue_index' ? '6rem' : '9rem';

  return (
    <div className="overflow-hidden rounded-lg border" style={{ background, color: text, borderColor: border }}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-xs" style={{ borderColor: border }}>
        <span style={{ fontFamily: body ? `"${body.family}", sans-serif` : undefined }}>{concept.name}</span>
        <span className="flex gap-2 opacity-70">
          {concept.story.chapters.slice(0, 4).map((chapter) => <span key={chapter.name}>{chapter.name}</span>)}
        </span>
      </div>
      <div className="grid gap-3 p-4" style={{ gridTemplateColumns: `repeat(${family === 'cinematic_full_bleed' ? 1 : columns}, minmax(0, 1fr))` }}>
        <div
          className="flex flex-col justify-end p-3"
          style={{ gridColumn: '1 / -1', minHeight: heroHeight, background: `linear-gradient(120deg, ${surface}, ${background})`, border: `1px solid ${border}` }}
        >
          <span className="text-[10px] uppercase tracking-[0.18em]" style={{ color: accent }}>{concept.composition.label}</span>
          <p className="mt-1 text-3xl leading-[1.02]" style={{ fontFamily: display ? `"${display.family}", Georgia, serif` : undefined }}>
            {concept.story.headline}
          </p>
          <p className="mt-2 max-w-md text-xs opacity-80" style={{ fontFamily: body ? `"${body.family}", sans-serif` : undefined }}>
            {concept.story.premise}
          </p>
        </div>
        <div className="p-3" style={{ gridColumn: textSpan, background: surface, border: `1px solid ${border}` }}>
          <p className="text-[10px] uppercase tracking-[0.16em]" style={{ color: accent }}>Chapter</p>
          <p className="mt-1 text-sm">{concept.story.chapters[0]?.intent}</p>
          <p className="mt-2 text-xs opacity-70">{concept.story.arc.slice(0, 2).join(' → ')}</p>
        </div>
        <div className="flex min-h-24 flex-col justify-between p-3" style={{ gridColumn: imageSpan, background: accent, color: roleHex(tokens, 'accent_text') }}>
          <ImageIcon className="size-4 opacity-80" aria-hidden />
          <p className="text-xs">{concept.imagery.assetIds.length ? `${concept.imagery.assetIds.length} approved file${concept.imagery.assetIds.length === 1 ? '' : 's'} referenced` : 'Photography commission'}</p>
        </div>
        <div className="p-3" style={{ gridColumn: '1 / -1', borderTop: `1px solid ${border}` }}>
          <p className="text-[10px] uppercase tracking-[0.16em]" style={{ color: accent }}>Primary action</p>
          <p className="text-sm font-medium">{concept.conversion.primaryCta}</p>
        </div>
      </div>
    </div>
  );
}

export function ConceptBoard({ concept, concepts, onSelect }: { concept: CreativeConcept; concepts: CreativeConcept[]; onSelect: (key: string) => void }) {
  return (
    <Card>
      <CardHeader
        title={`Direction board — ${concept.name}`}
        description="A composition and type study, not a page. Blocks show hierarchy and intent; no font file or photograph is loaded here."
        actions={
          <div className="flex flex-wrap gap-1">
            {concepts.map((entry) => (
              <Button key={entry.key} size="sm" variant={entry.key === concept.key ? 'primary' : 'ghost'} onClick={() => onSelect(entry.key)}>{entry.name}</Button>
            ))}
          </div>
        }
      />
      <CardBody className="space-y-5">
        <CompositionDiagram concept={concept} />
        <Notice tone="neutral" title="What this board is, and is not">
          The diagram is a Studio artefact: it demonstrates hierarchy, grid and colour logic. It is not a rendered website, not a client preview and not a substitute for the phase 4 build.
        </Notice>

        <div className="grid gap-4 lg:grid-cols-2">
          <section>
            <h3 className="text-sm font-semibold">Composition</h3>
            <p className="mt-1 text-sm text-muted">{concept.composition.grid}</p>
            <p className="mt-2 text-sm text-muted">{concept.composition.navigation}</p>
            <p className="mt-2 text-sm text-muted">{concept.composition.hero}</p>
            <p className="mt-2 text-xs text-subtle">{concept.composition.spacing}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {concept.composition.materials.map((material) => <Badge key={material} tone="neutral">{material}</Badge>)}
            </div>
          </section>
          <section>
            <h3 className="text-sm font-semibold">Typography and scale</h3>
            <p className="mt-1 text-sm text-muted">{concept.typography.rationale}</p>
            <dl className="mt-2 space-y-1 text-xs">
              {concept.tokens.type.steps.filter((step) => ['display', 'h1', 'h2', 'body', 'small'].includes(step.name)).map((step) => (
                <div key={step.name} className="flex justify-between gap-3 border-b border-border py-1">
                  <dt className="capitalize">{step.name} <span className="text-subtle">/ {step.use}</span></dt>
                  <dd className="shrink-0 tabular text-subtle">{step.minRem}–{step.maxRem}rem · {step.lineHeight} · {step.tracking}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-xs text-subtle">{concept.typography.notes}</p>
          </section>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <section>
            <h3 className="text-sm font-semibold">Colour system</h3>
            <p className="mt-1 text-sm text-muted">{concept.colour.strategy}</p>
            <ul className="mt-2 space-y-1 text-xs">
              {concept.colour.contrast.map((check) => (
                <li key={check.usage} className="flex flex-wrap items-center gap-2">
                  <Badge tone={check.passesAA ? 'success' : 'danger'}>{check.ratio}:1</Badge>
                  <span className="text-subtle">{check.usage}</span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3 className="text-sm font-semibold">Imagery</h3>
            <p className="mt-1 text-sm text-muted">{concept.imagery.direction}</p>
            <p className="mt-2 text-xs text-subtle">{concept.imagery.treatment}</p>
            {concept.imagery.missing.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-warning">
                {concept.imagery.missing.map((item) => <li key={item}>— {item}</li>)}
              </ul>
            )}
            {concept.imagery.assetIds.length > 0 && (
              <p className="mt-2 text-xs text-subtle">{concept.imagery.assetIds.length} approved asset{concept.imagery.assetIds.length === 1 ? '' : 's'} referenced. Preview the files in the Asset vault; the board does not re-host them.</p>
            )}
            {concept.imagery.logoAssetIds.length > 0 && <p className="mt-1 text-xs text-subtle">{concept.imagery.logoAssetIds.length} approved mark{concept.imagery.logoAssetIds.length === 1 ? '' : 's'} cleared for prototype use.</p>}
          </section>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <section>
            <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Move className="size-4" aria-hidden /> Motion</h3>
            <p className="mt-1 text-sm text-muted">{concept.motion.idea}</p>
            <dl className="mt-2 grid grid-cols-2 gap-1 text-xs">
              <div><dt className="text-subtle">Duration</dt><dd>{concept.motion.spec.durationMs}ms</dd></div>
              <div><dt className="text-subtle">Easing</dt><dd className="break-all">{concept.motion.spec.easing}</dd></div>
              <div><dt className="text-subtle">Distance</dt><dd>{concept.motion.spec.distancePx}px</dd></div>
              <div><dt className="text-subtle">Properties</dt><dd>{concept.motion.spec.properties.join(', ')}</dd></div>
            </dl>
            <p className="mt-2 text-xs text-subtle">Reduced motion: {concept.motion.reducedMotion}</p>
            <ul className="mt-1 space-y-1 text-xs text-subtle">{concept.motion.performance.map((item) => <li key={item}>— {item}</li>)}</ul>
          </section>
          <section>
            <h3 className="text-sm font-semibold">Conversion path</h3>
            <ol className="mt-1 space-y-1 text-sm text-muted">
              {concept.conversion.path.map((step, index) => <li key={step}>{index + 1}. {step}</li>)}
            </ol>
            <p className="mt-2 text-xs text-subtle">Proof order: {concept.conversion.proofOrder.join(' · ')}</p>
            <p className="mt-1 text-xs text-subtle">Friction to remove: {concept.conversion.friction.join(' · ')}</p>
          </section>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <section>
            <h3 className="text-sm font-semibold">Story</h3>
            <p className="mt-1 text-sm text-muted">{concept.story.premise}</p>
            <ol className="mt-2 space-y-1 text-sm">
              {concept.story.chapters.map((chapter) => (
                <li key={chapter.name}><span className="font-medium">{chapter.name}</span> — {chapter.intent}</li>
              ))}
            </ol>
          </section>
          <section>
            <h3 className="text-sm font-semibold">Rationale and evidence</h3>
            <p className="mt-1 text-sm text-muted">{concept.rationale.audience}</p>
            <p className="mt-2 text-sm text-muted">{concept.rationale.business}</p>
            {concept.rationale.evidence.observationIds.length > 0 ? (
              <ul className="mt-2 space-y-1 text-xs text-subtle">
                {concept.rationale.evidence.observationLabels.map((label) => <li key={label}>“{label}”</li>)}
                <li title={concept.rationale.evidence.observationIds.join(', ')}>{concept.rationale.evidence.observationIds.length} observation(s) cited</li>
              </ul>
            ) : (
              <p className="mt-2 text-xs text-subtle">No verified observation is cited; the concept rests on the approved kit and the Studio’s proposal.</p>
            )}
            {concept.rationale.evidence.brandKitVersion && <p className="mt-1 text-xs text-subtle">Brand Kit version {concept.rationale.evidence.brandKitVersion}.</p>}
          </section>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <section>
            <h3 className="text-sm font-semibold">Trade-offs accepted</h3>
            <ul className="mt-1 space-y-1 text-sm text-muted">{concept.tradeoffs.map((tradeoff) => <li key={tradeoff}>— {tradeoff}</li>)}</ul>
          </section>
          <section>
            <h3 className="text-sm font-semibold">Risks to watch</h3>
            <ul className="mt-1 space-y-1 text-sm text-muted">{concept.risks.map((risk) => <li key={risk}>— {risk}</li>)}</ul>
          </section>
        </div>

        <section>
          <h3 className="text-sm font-semibold">References</h3>
          <ul className="mt-2 space-y-2 text-sm">
            {concept.imagery.references.map((reference) => (
              <li key={`${reference.title}-${reference.url ?? ''}`} className="flex flex-wrap items-start gap-2">
                <Badge tone="neutral">{reference.licence}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {reference.url ? (
                      <a href={reference.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline-offset-2 hover:underline">
                        {reference.title} <ExternalLink className="size-3" aria-hidden />
                      </a>
                    ) : reference.title}
                  </p>
                  <p className="text-xs text-subtle">{reference.note}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </CardBody>
    </Card>
  );
}


