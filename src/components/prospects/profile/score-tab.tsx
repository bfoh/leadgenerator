'use client';

import { HelpCircle, RefreshCw, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import * as research from '@/lib/data/research-services';
import * as svc from '@/lib/data/services';
import { BAND_META, DEFAULT_WEIGHTS } from '@/lib/domain/scoring';
import type { Business } from '@/lib/domain/types';
import { cn, formatDateTime } from '@/lib/utils';
import { useAction, useAuditEvents, useResearchSchema } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { ScoreBar } from '@/components/records/badges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/field';
import { EmptyState, Notice } from '@/components/ui/misc';

export function ScoreTab({ business }: { business: Business }) {
  const { can, settings } = useWorkspace();
  const rescore = useAction(svc.rescoreBusiness, { success: 'Score recalculated' });
  const s = business.scoreBreakdown;
  const custom = JSON.stringify(settings.scoringWeights) !== JSON.stringify(DEFAULT_WEIGHTS);
  const totalWeight = s?.factors.reduce((sum, f) => sum + f.weight, 0) || 1;

  if (!s) {
    return (
      <EmptyState
        title="Not scored yet"
        action={
          can('prospects.write') && (
            <Button onClick={() => rescore.run(business)} loading={rescore.pending}>
              <RefreshCw /> Calculate score
            </Button>
          )
        }
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className="space-y-5">
        <Card>
          <CardBody className="space-y-5">
            <div>
              <p className="flex items-center gap-2 text-xs text-subtle">
                Opportunity score {business.scoreOverride && <Badge tone="warning">Set by a person</Badge>}
              </p>
              <p className="mt-1 flex items-baseline gap-2">
                <span className="text-4xl font-semibold tabular tracking-tight">{business.scoreOverride?.opportunity ?? s.opportunity}</span>
                <span className="text-sm text-subtle">/ 100</span>
              </p>
              <ScoreBar value={business.scoreOverride?.opportunity ?? s.opportunity} label="Opportunity score" className="mt-2" />
              {business.scoreOverride && <p className="mt-2 text-xs text-subtle">Computed by the rules: {s.opportunity}/100.</p>}
              <p className="mt-2 text-sm font-medium">{BAND_META[s.band].label}</p>
              <p className="text-xs text-subtle">
                {business.scoreOverride ? 'Computed band' : 'Band'} {BAND_META[s.band].range}
              </p>
            </div>
            <div className="border-t border-border pt-4">
              <p className="text-xs text-subtle">Confidence</p>
              <p className="mt-1 text-2xl font-semibold tabular">{s.confidence}%</p>
              <p className="mt-1 text-xs text-subtle">How much of the score rests on verified, recent evidence rather than unknowns. A high score with low confidence means “promising but unconfirmed”.</p>
            </div>
            <p className="text-xs text-subtle">Calculated {formatDateTime(s.computedAt)}</p>
            {can('prospects.write') && (
              <Button size="sm" onClick={() => rescore.run(business)} loading={rescore.pending}>
                <RefreshCw /> Recalculate
              </Button>
            )}
          </CardBody>
        </Card>
        <ScoreOverrideCard business={business} />
        {s.flags.length > 0 && (
          <Notice tone="warning" title="Flags">
            <ul className="list-disc space-y-0.5 pl-4">
              {s.flags.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </Notice>
        )}
      </div>

      <Card>
        <CardHeader
          title="How this score was calculated"
          description={
            <>
              Each factor is scored 0–100 and weighted. Unknown factors count as neutral (50) and lower confidence.{' '}
              {custom ? 'Your workspace uses custom weights.' : 'Default weights.'}{' '}
              {can('settings.manage') && (
                <Link href="/settings?tab=scoring" className="underline">
                  Adjust weights
                </Link>
              )}
            </>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="border-b border-border text-left text-xs text-subtle">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">Factor</th>
                <th scope="col" className="px-4 py-2 font-medium">Value</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Weight</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Points</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {s.factors.map((f) => (
                <tr key={f.factor} className="align-top">
                  <td className="px-4 py-3">
                    <p className="font-medium">{f.label}</p>
                    <p className={cn('mt-0.5 text-xs', f.known ? 'text-subtle' : 'text-warning')}>
                      {!f.known && <HelpCircle className="mr-1 inline size-3" aria-label="Unknown" />}
                      {f.reason}
                    </p>
                  </td>
                  <td className="w-40 px-4 py-3">
                    <ScoreBar value={f.value} label={`${f.label} value`} />
                    <span className="mt-1 block text-xs tabular text-subtle">{f.value} / 100</span>
                  </td>
                  <td className="px-4 py-3 text-right tabular text-subtle">{Math.round((f.weight / totalWeight) * 100)}%</td>
                  <td className="px-4 py-3 text-right font-medium tabular">{f.contribution.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-border">
              <tr>
                <td colSpan={3} className="px-4 py-2.5 text-right text-xs text-subtle">
                  Total{business.businessStatus === 'inactive' ? ' (capped: business appears inactive)' : ''}
                </td>
                <td className="px-4 py-2.5 text-right font-semibold tabular">{s.opportunity}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  );
}

/** A person's override of the computed score, with its justification and history. */
function ScoreOverrideCard({ business }: { business: Business }) {
  const { can } = useWorkspace();
  const { data: schema } = useResearchSchema();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(String(business.scoreOverride?.opportunity ?? business.scoreBreakdown?.opportunity ?? ''));
  const [justification, setJustification] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const audit = useAuditEvents(showHistory ? business.id : null);
  const set = useAction((ctx) => research.setScoreOverride(ctx, business, Number(value), justification), {
    success: 'Score override saved',
    onSuccess: () => {
      setOpen(false);
      setJustification('');
    },
  });
  const clear = useAction((ctx) => research.clearScoreOverride(ctx, business), { success: 'Override removed; the computed score applies' });
  const o = business.scoreOverride;
  // Cloud audit rows use column names, demo rows use field names.
  const overrideChange = (changes: Record<string, { old: unknown; new: unknown }> | null) => changes?.score_override ?? changes?.scoreOverride ?? null;
  const history = (audit.data ?? []).filter((e) => overrideChange(e.changes));
  if (schema === false) return null;
  const tooShort = justification.trim().length < research.OVERRIDE_JUSTIFICATION_MIN;
  const number = Number(value);
  const invalid = value.trim() === '' || !Number.isFinite(number) || number < 0 || number > 100;

  return (
    <Card>
      <CardHeader title="Manual override" as="h3" description="Rules decide the score. A person may override it with a written reason; the computed score stays visible and every change is audited." />
      <CardBody className="space-y-3 text-sm">
        {o ? (
          <div className="space-y-1">
            <p>
              Set to <strong>{o.opportunity}</strong> by {o.byName} on {o.at.slice(0, 10)}.
            </p>
            <p className="whitespace-pre-wrap text-xs text-muted">“{o.justification}”</p>
          </div>
        ) : (
          <p className="text-xs text-subtle">No override. The opportunity score is the computed one.</p>
        )}
        {can('scores.override') && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setOpen(true)}>
              <SlidersHorizontal /> {o ? 'Change override' : 'Override score'}
            </Button>
            {o && (
              <Button size="sm" variant="ghost" loading={clear.pending} onClick={() => void clear.run()}>
                Remove override
              </Button>
            )}
          </div>
        )}
        <button type="button" className="text-xs text-subtle underline" onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory}>
          {showHistory ? 'Hide override history' : 'Show override history'}
        </button>
        {showHistory && (
          <ul className="space-y-1.5 text-xs">
            {audit.isLoading ? (
              <li className="text-subtle">Loading…</li>
            ) : history.length === 0 ? (
              <li className="text-subtle">No override changes recorded.</li>
            ) : (
              history.map((e) => {
                const next = overrideChange(e.changes)!.new as { opportunity?: number; justification?: string } | null;
                return (
                  <li key={e.id}>
                    {formatDateTime(e.createdAt)} · {next ? `set to ${next.opportunity}: ${next.justification ?? ''}` : 'removed'}
                  </li>
                );
              })
            )}
          </ul>
        )}
      </CardBody>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        size="sm"
        title="Override the opportunity score"
        description="Use this when you know something the rules cannot see, such as what the owner told you. Say what it is."
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={tooShort || invalid} loading={set.pending} onClick={() => void set.run()}>
              Save override
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Opportunity score (0–100)" required error={value && invalid ? 'Enter a number from 0 to 100.' : undefined}>
            {(p) => <Input {...p} type="number" min={0} max={100} inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} />}
          </Field>
          <Field label="Justification" required hint={`At least ${research.OVERRIDE_JUSTIFICATION_MIN} characters. Recorded with your name.`}>
            {(p) => <Textarea {...p} value={justification} maxLength={1000} onChange={(e) => setJustification(e.target.value)} placeholder="For example: the owner asked us for a quote for an online booking site." />}
          </Field>
        </div>
      </Dialog>
    </Card>
  );
}
