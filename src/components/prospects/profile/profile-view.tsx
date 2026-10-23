'use client';

import { ArrowLeft, Building2, GitMerge, MoreHorizontal, Pencil, Trash2, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import * as research from '@/lib/data/research-services';
import * as svc from '@/lib/data/services';
import type { Business } from '@/lib/domain/types';
import { useAction, useActivities, useAuditFindings, useBusiness, useProposals, useReports, useVerifications } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { AutomateResearchButton, ProspectWorkflowBadge } from '@/components/automation/prospect-automation';
import { PermissionBadge, ScorePill, StageBadge, WebsiteStatusBadge } from '@/components/records/badges';
import { StageControl } from '@/components/records/stage-control';
import { Button, ButtonLink } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { EmptyState, Notice, PageSkeleton } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BusinessFormDialog } from '../business-form-dialog';
import { ActivityTab } from './activity-tab';
import { AuditTab } from './audit-tab';
import { OverviewTab } from './overview-tab';
import { ContactsTab } from './contacts-tab';
import { NextStepsTab } from './next-steps-tab';
import { ProposalsTab } from './proposals-tab';
import { ReportsTab } from './reports-tab';
import { ScoreTab } from './score-tab';
import { VerificationTab } from './verification-tab';

const TABS = ['overview', 'verification', 'audit', 'score', 'contacts', 'next', 'reports', 'proposals', 'activity'] as const;
type Tab = (typeof TABS)[number];
/** Old links keep working: the contact permission form now lives on the Contacts tab. */
const TAB_ALIASES: Record<string, Tab> = { permission: 'contacts' };

export function ProfileView({ id }: { id: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { data: business, isLoading } = useBusiness(id);
  const raw = params.get('tab');
  const tabParam = (raw && (TAB_ALIASES[raw] ?? raw)) as Tab | null;
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : 'overview';

  if (isLoading) return <PageSkeleton />;
  if (!business) {
    return (
      <EmptyState
        icon={Building2}
        title="Prospect not found"
        description="It may have been deleted, or it belongs to another workspace."
        action={<ButtonLink href="/prospects">Back to prospects</ButtonLink>}
      />
    );
  }

  const setTab = (value: string) => router.replace(`${pathname}${value === 'overview' ? '' : `?tab=${value}`}`, { scroll: false });

  return (
    <>
      <Header business={business} onTab={setTab} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList label="Prospect sections" className="mb-5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="verification">Website verification</TabsTrigger>
          <CountedTab value="audit" businessId={business.id} />
          <TabsTrigger value="score">Score</TabsTrigger>
          <TabsTrigger value="contacts">Contacts</TabsTrigger>
          <TabsTrigger value="next">Next steps</TabsTrigger>
          <CountedTab value="reports" businessId={business.id} />
          <CountedTab value="proposals" businessId={business.id} />
          <CountedTab value="activity" businessId={business.id} />
        </TabsList>
        <TabsContent value="overview">
          <OverviewTab business={business} onTab={setTab} />
        </TabsContent>
        <TabsContent value="verification">
          <VerificationTab business={business} />
        </TabsContent>
        <TabsContent value="audit">
          <AuditTab business={business} />
        </TabsContent>
        <TabsContent value="score">
          <ScoreTab business={business} />
        </TabsContent>
        <TabsContent value="contacts">
          <ContactsTab business={business} />
        </TabsContent>
        <TabsContent value="next">
          <NextStepsTab business={business} />
        </TabsContent>
        <TabsContent value="reports">
          <ReportsTab business={business} />
        </TabsContent>
        <TabsContent value="proposals">
          <ProposalsTab business={business} />
        </TabsContent>
        <TabsContent value="activity">
          <ActivityTab business={business} />
        </TabsContent>
      </Tabs>
    </>
  );
}

function CountedTab({ value, businessId }: { value: 'audit' | 'reports' | 'proposals' | 'activity'; businessId: string }) {
  const reports = useReports(businessId);
  const proposals = useProposals();
  const activities = useActivities(businessId);
  const findings = useAuditFindings(businessId);
  const count =
    value === 'audit'
      ? findings.data?.filter((f) => f.reviewStatus !== 'superseded' && f.reviewStatus !== 'dismissed').length
      : value === 'reports'
        ? reports.data?.length
        : value === 'proposals'
          ? proposals.data?.filter((p) => p.businessId === businessId).length
          : activities.data?.length;
  const label = { audit: 'Digital audit', reports: 'Reports', proposals: 'Proposals', activity: 'Activity' }[value];
  return (
    <TabsTrigger value={value} count={count}>
      {label}
    </TabsTrigger>
  );
}

function Header({ business, onTab }: { business: Business; onTab: (tab: string) => void }) {
  const { can } = useWorkspace();
  const router = useRouter();
  const { data: verifications = [] } = useVerifications(business.id);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const remove = useAction(svc.deleteBusiness, { success: 'Prospect deleted', onSuccess: () => router.push('/prospects') });

  return (
    <header className="mb-5">
      <Link href="/prospects" className="mb-3 inline-flex items-center gap-1 text-xs text-subtle hover:text-foreground">
        <ArrowLeft className="size-3.5" aria-hidden /> Prospects
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{business.name}</h1>
          <p className="mt-0.5 text-sm text-subtle">
            {business.category} · {[business.neighborhood, business.city].filter(Boolean).join(', ')}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <WebsiteStatusBadge status={business.websiteStatus} outdated={business.websiteOutdated} />
            <StageBadge stage={business.stage} />
            <PermissionBadge permission={business.contactPermission} />
            <ProspectWorkflowBadge business={business} />
            <span className="ml-1">
              <ScorePill score={business.opportunityScore} confidence={business.confidenceScore} />
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {business.websiteStatus === 'unverified' && can('verification.write') && (
            <Button variant="primary" onClick={() => onTab('verification')}>
              Verify website
            </Button>
          )}
          <AutomateResearchButton business={business} />
          {/* A merged duplicate stays archived; the notice below offers Undo merge instead. */}
          {!business.mergedIntoId && <StageControl business={business} />}
          {can('prospects.write') && (
            <Button onClick={() => setEditing(true)}>
              <Pencil /> Edit
            </Button>
          )}
          {can('records.delete') && (
            <Menu>
              <MenuTrigger asChild>
                <Button size="icon" aria-label="More actions">
                  <MoreHorizontal />
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuItem danger onSelect={() => setDeleting(true)}>
                  <Trash2 /> Delete prospect
                </MenuItem>
              </MenuContent>
            </Menu>
          )}
        </div>
      </div>
      {business.mergedIntoId && <MergedNotice business={business} />}
      {business.contactPermission === 'opted_out' && (
        <Notice tone="danger" className="mt-4" title="Opted out — do not contact">
          This business asked not to be contacted{business.optedOutAt ? ` (recorded ${business.optedOutAt.slice(0, 10)})` : ''}. Outreach stages and contact logging are blocked.
        </Notice>
      )}
      {business.stage === 'lost' && business.lostReason && (
        <Notice tone="neutral" className="mt-4" title="Lost">
          {business.lostReason}
        </Notice>
      )}
      {editing && <BusinessFormDialog open={editing} onOpenChange={setEditing} business={business} />}
      <Dialog
        open={deleting}
        onOpenChange={setDeleting}
        size="sm"
        title={`Delete ${business.name}?`}
        description="This permanently removes the prospect with its verifications, activity, reports and proposals. Prospects with projects cannot be deleted."
        footer={
          <>
            <Button onClick={() => setDeleting(false)}>Cancel</Button>
            <Button variant="danger" loading={remove.pending} onClick={() => remove.run(business)}>
              Delete permanently
            </Button>
          </>
        }
      >
        <p className="text-sm text-subtle">
          {verifications.length} verification record{verifications.length === 1 ? '' : 's'} will be removed. Consider moving it to <strong>Archived</strong> instead to keep the research history.
        </p>
      </Dialog>
    </header>
  );
}

/** Shown on a record that was merged into another one. */
function MergedNotice({ business }: { business: Business }) {
  const { can } = useWorkspace();
  const { data: primary } = useBusiness(business.mergedIntoId!);
  const undo = useAction((ctx) => research.undoProspectMerge(ctx, business, primary ?? null), { success: 'Merge undone; this prospect is separate again' });
  return (
    <Notice tone="warning" className="mt-4" icon={GitMerge} title="Merged duplicate">
      <p>
        This record was merged into{' '}
        {primary ? (
          <Link href={`/prospects/${primary.id}`} className="font-medium">
            {primary.name}
          </Link>
        ) : (
          'another prospect'
        )}{' '}
        and archived. Its history is kept here; research continues on the kept record.
      </p>
      {can('identity.merge') && (
        <Button size="sm" className="mt-2" loading={undo.pending} onClick={() => void undo.run()}>
          <Undo2 /> Undo merge
        </Button>
      )}
    </Notice>
  );
}
