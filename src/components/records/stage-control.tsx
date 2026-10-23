'use client';

import { ChevronDown, Lock } from 'lucide-react';
import { useState } from 'react';
import * as svc from '@/lib/data/services';
import { STAGES, STAGE_LABELS, type Stage } from '@/lib/domain/constants';
import { canEnterStage } from '@/lib/domain/pipeline';
import type { Business } from '@/lib/domain/types';
import { useAction } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/field';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@/components/ui/menu';

/** Stage menu that shows why gated stages are unavailable and asks for a lost reason. */
export function StageControl({ business, size = 'md', label }: { business: Business; size?: 'sm' | 'md'; label?: string }) {
  const { can } = useWorkspace();
  const [lostOpen, setLostOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const move = useAction((ctx, stage: Stage, lostReason?: string) => svc.changeStage(ctx, business, stage, { lostReason }), {
    success: (b) => `Moved to ${STAGE_LABELS[b.stage]}`,
    onSuccess: () => {
      setLostOpen(false);
      setReason('');
    },
  });

  if (!can('prospects.write')) return null;

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button size={size} loading={move.pending} aria-label={`Change stage for ${business.name}`}>
            {label ?? 'Move stage'} <ChevronDown />
          </Button>
        </MenuTrigger>
        <MenuContent className="w-72">
          <MenuLabel>Move to</MenuLabel>
          {STAGES.filter((s) => s !== business.stage).map((s, i, list) => {
            const gate = canEnterStage(business, s);
            return (
              <div key={s}>
                {s === 'won' && i > 0 && list[i - 1] !== 'won' && <MenuSeparator />}
                <MenuItem disabled={!gate.ok} title={gate.ok ? undefined : gate.reason} onSelect={() => (s === 'lost' ? setLostOpen(true) : move.run(s))}>
                  <span className="flex-1">{STAGE_LABELS[s]}</span>
                  {!gate.ok && <Lock aria-label="Locked" />}
                </MenuItem>
                {!gate.ok && <p className="-mt-0.5 px-2 pb-1.5 text-[11px] leading-snug text-subtle">{gate.reason}</p>}
              </div>
            );
          })}
        </MenuContent>
      </Menu>
      <Dialog
        open={lostOpen}
        onOpenChange={setLostOpen}
        size="sm"
        title="Mark as lost"
        description="The reason is kept for analytics and future follow-up."
        footer={
          <>
            <Button onClick={() => setLostOpen(false)}>Cancel</Button>
            <Button
              variant="danger"
              loading={move.pending}
              onClick={() => {
                if (!reason.trim()) return setError('Record why the opportunity was lost.');
                setError(null);
                move.run('lost', reason);
              }}
            >
              Mark as lost
            </Button>
          </>
        }
      >
        <Field label="Lost reason" required error={error ?? undefined}>
          {(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Chose another agency; budget not available this year" />}
        </Field>
      </Dialog>
    </>
  );
}
