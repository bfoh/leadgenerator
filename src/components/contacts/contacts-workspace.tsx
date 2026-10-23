'use client';

import { BookUser, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CONTACTS_MIGRATION_REQUIRED } from '@/lib/data/store';
import { activeSuppressions, channelOf, consentFor, contactStatus, retentionDue, type ContactPoint } from '@/lib/domain/contacts';
import { useBusinesses, useConsentRecords, useContactPoints, useContactSchema, useSuppressions } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState, Notice, PageHeader, PageSkeleton } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AddSuppressionDialog, ContactList, DeleteContactsDialog, SuppressionList, type ContactState } from './contact-ui';

const FILTERS = {
  all: 'All',
  review: 'Needs review',
  invalid: 'Invalid or outdated',
  retention: 'Past retention date',
  suppressed: 'Suppressed or opted out',
  consent: 'Consent on file',
} as const;
type Filter = keyof typeof FILTERS;

export function ContactsWorkspace() {
  const { can } = useWorkspace();
  const { data: schema } = useContactSchema();
  const enabled = schema === true;
  const { data: businesses } = useBusinesses();
  const { data: points } = useContactPoints(undefined, enabled);
  const { data: consents = [] } = useConsentRecords(undefined, enabled);
  const { data: suppressions = [] } = useSuppressions(enabled);
  const [filter, setFilter] = useState<Filter>('all');
  const [dialog, setDialog] = useState<'suppress' | 'purge' | null>(null);

  const state: ContactState = useMemo(() => ({ points: points ?? [], consents, suppressions }), [points, consents, suppressions]);
  const byId = useMemo(() => new Map((businesses ?? []).map((b) => [b.id, b])), [businesses]);
  const today = new Date().toISOString().slice(0, 10);

  const matches = useMemo(() => {
    const now = new Date();
    const test: Record<Filter, (p: ContactPoint) => boolean> = {
      all: () => true,
      review: (p) => p.classification === 'unverified' || p.scope === 'unknown',
      invalid: (p) => p.classification === 'invalid' || p.classification === 'outdated',
      retention: (p) => retentionDue(p, today),
      suppressed: (p) => {
        const b = byId.get(p.businessId);
        return Boolean(b) && ['suppressed', 'opted_out'].includes(contactStatus(p, { business: b!, ...state, now }));
      },
      consent: (p) => {
        const channel = channelOf(p.type);
        return Boolean(channel) && consentFor(p.businessId, channel!, p.id, state.consents, now).state === 'granted';
      },
    };
    return Object.fromEntries((Object.keys(FILTERS) as Filter[]).map((f) => [f, state.points.filter(test[f])])) as Record<Filter, ContactPoint[]>;
  }, [state, byId, today]);

  if (schema === false) {
    return (
      <>
        <PageHeader title="Contacts" description="Contact details with their source, consent records and the suppression list." />
        <Notice tone="warning" icon={ShieldAlert} title="Contact tracking is not set up for this workspace">
          {CONTACTS_MIGRATION_REQUIRED}
        </Notice>
      </>
    );
  }
  if (!points || !businesses) return <PageSkeleton />;

  const active = activeSuppressions(suppressions).length;
  const due = matches.retention;

  return (
    <>
      <PageHeader
        title="Contacts"
        description="Business contact details with their source, validation and consent, and the workspace-wide suppression list. A contact detail is never permission to message it; in this version messages can reach only sandbox test recipients."
      />
      <dl className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          ['Contact details', points.length],
          ['Needs review', matches.review.length],
          ['Consent on file', matches.consent.length],
          ['Past retention date', due.length],
          ['Active suppressions', active],
        ].map(([label, n]) => (
          <div key={label} className="rounded-lg border border-border bg-surface px-3 py-2.5">
            <dt className="text-xs text-subtle">{label}</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular">{n}</dd>
          </div>
        ))}
      </dl>

      <Tabs defaultValue="details">
        <TabsList label="Contact sections" className="mb-5">
          <TabsTrigger value="details" count={points.length}>
            Contact details
          </TabsTrigger>
          <TabsTrigger value="suppression" count={active}>
            Suppression list
          </TabsTrigger>
        </TabsList>
        <TabsContent value="details">
          <Card>
            <CardHeader
              title={FILTERS[filter]}
              description="Status combines the source, validation, consent and the suppression list."
              actions={
                can('contacts.delete') && due.length > 0 ? (
                  <Button size="sm" variant="outline-danger" onClick={() => setDialog('purge')}>
                    <Trash2 aria-hidden /> Delete {due.length} past retention
                  </Button>
                ) : null
              }
            />
            <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-2" role="group" aria-label="Filter contact details">
              {(Object.keys(FILTERS) as Filter[]).map((f) => (
                <Button key={f} size="sm" variant={filter === f ? 'primary' : 'ghost'} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                  {FILTERS[f]} <span className="tabular opacity-70">{matches[f].length}</span>
                </Button>
              ))}
            </div>
            <ContactList
              points={matches[filter]}
              businesses={businesses}
              state={state}
              showBusiness
              empty={
                <EmptyState
                  icon={BookUser}
                  title={filter === 'all' ? 'No contact details yet' : 'Nothing here'}
                  description={filter === 'all' ? 'Contact research runs after a prospect qualifies, or add details on a prospect’s Contacts tab.' : 'No contact details match this filter.'}
                />
              }
            />
          </Card>
        </TabsContent>
        <TabsContent value="suppression">
          <Card>
            <CardHeader
              title="Suppression list"
              description="Workspace-wide and always applied first: suppression wins over any recommendation or approval. Entries are never deleted."
              actions={
                can('contacts.write') ? (
                  <Button size="sm" onClick={() => setDialog('suppress')}>
                    <Plus aria-hidden /> Add to suppression list
                  </Button>
                ) : null
              }
            />
            <SuppressionList state={state} businesses={businesses} />
          </Card>
        </TabsContent>
      </Tabs>
      {dialog === 'suppress' && <AddSuppressionDialog onClose={() => setDialog(null)} />}
      {dialog === 'purge' && <DeleteContactsDialog points={due} reason="retention period ended" onClose={() => setDialog(null)} />}
    </>
  );
}
