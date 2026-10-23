'use client';

import { Bot, ListChecks, Plus, ShieldAlert, ShieldCheck, UserRoundSearch } from 'lucide-react';
import { useState } from 'react';
import * as contacts from '@/lib/data/contact-services';
import { CONTACTS_MIGRATION_REQUIRED } from '@/lib/data/store';
import { normalizeContact } from '@/lib/domain/contacts';
import type { Business } from '@/lib/domain/types';
import { useServerStatus } from '@/lib/workspace/api';
import { describeRun, researchable, runAgentNow, useAutomationAction, useAutomationAvailable } from '@/lib/workspace/automation';
import { useAction, useConsentRecords, useContactPoints, useContactSchema, useSuppressions } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { AddContactDialog, ConsentDialog, ConsentHistory, ContactList, ContactSummary, businessSuppressed, type ContactState } from '@/components/contacts/contact-ui';
import { ProspectMessages } from '@/components/outreach/message-ui';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState, Notice, Skeleton } from '@/components/ui/misc';
import { PermissionTab } from './permission-tab';

/** Profile phone/email values not yet tracked as contact points. */
function untracked(business: Business, state: ContactState) {
  return (['phone', 'email'] as const).filter((type) => {
    const value = business[type];
    if (!value?.trim()) return false;
    const n = normalizeContact(type, value);
    return n.ok && !state.points.some((p) => (p.type === type || (type === 'phone' && p.type === 'whatsapp')) && p.normalizedValue === n.normalized);
  });
}

export function ContactsTab({ business }: { business: Business }) {
  const { can, workspace } = useWorkspace();
  const { data: schema } = useContactSchema();
  const enabled = schema === true;
  const { data: points, isLoading } = useContactPoints(business.id, enabled);
  const { data: consents = [] } = useConsentRecords(business.id, enabled);
  const { data: suppressions = [] } = useSuppressions(enabled);
  const { data: automation } = useAutomationAvailable();
  const { data: status } = useServerStatus();
  const [dialog, setDialog] = useState<'add' | 'consent' | null>(null);
  const research = useAutomationAction((a, b: Business) => runAgentNow(a, workspace.mode, 'contact_research', b, { force: true }), { success: ({ run }) => describeRun(run) });
  const validate = useAutomationAction((a, b: Business) => runAgentNow(a, workspace.mode, 'contact_validation', b, {}), { success: ({ run }) => describeRun(run) });
  const track = useAction(contacts.importProfileContacts, { success: (created) => `Tracking ${created.length} profile detail${created.length === 1 ? '' : 's'} with provenance` });

  if (schema === false) {
    return (
      <div className="space-y-5">
        <Notice tone="warning" icon={ShieldAlert} title="Contact tracking is not set up for this workspace">
          {CONTACTS_MIGRATION_REQUIRED}
        </Notice>
        <PermissionTab business={business} />
      </div>
    );
  }
  if (!points || isLoading) return <Skeleton className="h-64" />;

  const state: ContactState = { points, consents, suppressions };
  const missing = untracked(business, state);
  const agents = Boolean(automation) && can('automation.run') && researchable(business);
  const blocked = business.contactPermission === 'opted_out' || businessSuppressed(business, suppressions);

  return (
    <div className="space-y-5">
      {blocked && (
        <Notice tone="danger" icon={ShieldAlert} title="Do not contact">
          This business opted out or is on the suppression list. Every channel is blocked and automation for it is stopped.
        </Notice>
      )}
      {status?.contacts?.simulated && (
        <Notice tone="warning" title="Simulated providers">
          This server uses the simulated test world (SIMULATE_EXTERNAL_TOOLS). Contact details found here are test data, not real research.
        </Notice>
      )}
      <ContactSummary business={business} state={state} />

      <Card>
        <CardHeader
          title="Discovered contact details"
          description="Published by the business or given to us, each with its source. A detail is never permission to message it."
          actions={
            <>
              {agents && (
                <>
                  <Button size="sm" loading={research.pending} onClick={() => void research.run(business)} title="Reads the verified official website (homepage and one contact page, robots.txt honoured) for the contact details the business publishes. No guessing, no social platforms, nothing is sent.">
                    <UserRoundSearch aria-hidden /> Find contact details
                  </Button>
                  {points.length > 0 && (
                    <Button size="sm" loading={validate.pending} onClick={() => void validate.run(business)} title="Checks syntax, domain and mail servers, normalises numbers to E.164 and flags duplicates. Mailboxes are never probed.">
                      <ListChecks aria-hidden /> Validate
                    </Button>
                  )}
                </>
              )}
              {can('contacts.write') && (
                <Button size="sm" onClick={() => setDialog('add')}>
                  <Plus aria-hidden /> Add contact detail
                </Button>
              )}
            </>
          }
        />
        {missing.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-muted px-4 py-2 text-xs">
            <span className="text-muted">The profile’s {missing.join(' and ')} {missing.length === 1 ? 'is' : 'are'} not tracked with a source yet.</span>
            {can('contacts.write') && (
              <Button size="sm" variant="ghost" loading={track.pending} onClick={() => void track.run(business)}>
                Track with provenance
              </Button>
            )}
          </div>
        )}
        <ContactList
          points={points}
          businesses={[business]}
          state={state}
          empty={
            <EmptyState
              icon={Bot}
              title="No contact details recorded"
              description={
                business.websiteStatus === 'verified_official'
                  ? 'Find the details the business publishes on its official website, or add one it gave you.'
                  : 'Contact research reads only a verified official website. Add details the business gave you, with their source.'
              }
            />
          }
        />
      </Card>

      <Card>
        <CardHeader
          title="Consent records"
          description="Append-only, per channel, with evidence. Direct marketing needs prior written consent (Act 843 s.40)."
          actions={
            can('consent.record') && business.contactPermission !== 'opted_out' ? (
              <Button size="sm" onClick={() => setDialog('consent')}>
                <ShieldCheck aria-hidden /> Record consent
              </Button>
            ) : null
          }
        />
        <ConsentHistory consents={consents} />
      </Card>

      <ProspectMessages business={business} />

      <section aria-labelledby="business-permission" className="space-y-2">
        <h2 id="business-permission" className="text-sm font-semibold">
          Business-level permission
        </h2>
        <PermissionTab business={business} />
      </section>

      {dialog === 'add' && <AddContactDialog business={business} onClose={() => setDialog(null)} />}
      {dialog === 'consent' && <ConsentDialog business={business} points={points} initial={{ channel: 'email', contactPointId: null, status: 'granted' }} onClose={() => setDialog(null)} />}
    </div>
  );
}
