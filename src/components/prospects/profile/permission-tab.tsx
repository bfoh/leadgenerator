'use client';

import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import * as svc from '@/lib/data/services';
import { CONTACT_PERMISSIONS, CONTACT_PERMISSION_META, LAWFUL_BASES, LAWFUL_BASIS_LABELS, type ContactPermission, type LawfulBasis } from '@/lib/domain/constants';
import { fieldErrors, permissionFormSchema } from '@/lib/domain/schemas';
import type { Business } from '@/lib/domain/types';
import { cn, formatDateTime } from '@/lib/utils';
import { useAction } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { PermissionBadge } from '@/components/records/badges';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Select, Textarea } from '@/components/ui/field';
import { DefinitionList, Notice } from '@/components/ui/misc';

const HELP: Record<ContactPermission, string> = {
  unknown: 'No contact has been agreed. Research only.',
  introduction_requested: 'You asked a mutual contact or the business’s public enquiry channel for an introduction. Wait for their reply before further contact.',
  granted: 'The business agreed to hear from you, contacted you first, or is an existing client. Record how.',
  declined: 'The business said no for now. Respect it; do not chase.',
  opted_out: 'The business asked not to be contacted. All outreach is blocked.',
};

export function PermissionTab({ business }: { business: Business }) {
  const { can } = useWorkspace();
  const [permission, setPermission] = useState<ContactPermission>(business.contactPermission);
  const [basis, setBasis] = useState<LawfulBasis | ''>(business.lawfulBasis ?? '');
  const [evidence, setEvidence] = useState(business.permissionEvidence ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useAction(svc.recordPermission, { success: 'Contact permission recorded' });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = permissionFormSchema.safeParse({ contactPermission: permission, lawfulBasis: basis || null, permissionEvidence: evidence });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    save.run(business, parsed.data);
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <CardHeader title="Record contact permission" description="Outreach stages, contact logging and sending proposals depend on this record." />
        <CardBody>
          {!can('prospects.write') ? (
            <p className="text-sm text-subtle">Your role cannot change contact permission.</p>
          ) : (
            <form onSubmit={submit} noValidate className="space-y-5">
              <fieldset>
                <legend className="mb-2 text-xs font-medium text-muted">Permission status</legend>
                <div className="grid gap-1.5">
                  {CONTACT_PERMISSIONS.map((p) => (
                    <label
                      key={p}
                      className={cn('flex cursor-pointer items-start gap-2.5 rounded-md border border-border px-3 py-2 hover:bg-surface-hover', permission === p && 'border-accent bg-accent-soft/50')}
                    >
                      <input type="radio" name="permission" checked={permission === p} onChange={() => setPermission(p)} className="mt-0.5 accent-[var(--accent)]" />
                      <span>
                        <span className="block text-sm font-medium">{CONTACT_PERMISSION_META[p].label}</span>
                        <span className="block text-xs text-subtle">{HELP[p]}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <Field label="Lawful basis" required={permission === 'granted'} error={errors.lawfulBasis}>
                {(p) => (
                  <Select {...p} value={basis} onChange={(e) => setBasis(e.target.value as LawfulBasis | '')}>
                    <option value="">Not applicable</option>
                    {LAWFUL_BASES.map((b) => (
                      <option key={b} value={b}>
                        {LAWFUL_BASIS_LABELS[b]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field
                label="Evidence"
                required={permission === 'granted'}
                error={errors.permissionEvidence}
                hint="Who agreed, when and how — e.g. “Owner replied on the Instagram business inbox on 12 Oct asking for a quote.”"
              >
                {(p) => <Textarea {...p} value={evidence} onChange={(e) => setEvidence(e.target.value)} />}
              </Field>
              <Button type="submit" variant="primary" loading={save.pending}>
                Save permission
              </Button>
            </form>
          )}
        </CardBody>
      </Card>

      <div className="space-y-5">
        <Card>
          <CardHeader title="Current record" />
          <CardBody className="space-y-4">
            <PermissionBadge permission={business.contactPermission} />
            <DefinitionList
              className="sm:grid-cols-1"
              items={[
                { label: 'Lawful basis', value: business.lawfulBasis ? LAWFUL_BASIS_LABELS[business.lawfulBasis] : null },
                { label: 'Evidence', value: business.permissionEvidence },
                { label: 'Recorded', value: business.permissionRecordedAt ? formatDateTime(business.permissionRecordedAt) : null },
              ]}
            />
          </CardBody>
        </Card>
        <Notice tone="info" icon={ShieldCheck} title="Ghana Data Protection Act, 2012 (Act 843)">
          Contact businesses through channels they publish for enquiries, one at a time, and only for a relevant purpose. A listed phone number is not consent to direct marketing. Record opt-outs immediately; they block all outreach.
        </Notice>
      </div>
    </div>
  );
}
