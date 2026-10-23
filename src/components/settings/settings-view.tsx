'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { Notice, PageHeader } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AgencyTab } from './agency-tab';
import { DataTab } from './data-tab';
import { IntegrationsTab } from './integrations-tab';
import { PackagesTab } from './packages-tab';
import { CategoriesTab, ScoringTab } from './scoring-tab';
import { TeamTab } from './team-tab';

const TABS = [
  { key: 'agency', label: 'Agency' },
  { key: 'scoring', label: 'Scoring' },
  { key: 'categories', label: 'Categories' },
  { key: 'packages', label: 'Packages & pricing' },
  { key: 'team', label: 'Team' },
  { key: 'integrations', label: 'Integrations' },
  { key: 'data', label: 'Data' },
] as const;

export function SettingsView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { can } = useWorkspace();
  const requested = params.get('tab');
  const tab = TABS.some((t) => t.key === requested) ? requested! : 'agency';

  return (
    <>
      <PageHeader title="Settings" description="Workspace configuration. Changes apply to everyone in the organization." />
      {!can('settings.manage') && (
        <Notice tone="neutral" className="mb-4">
          Only owners and administrators can change settings. You can view them here.
        </Notice>
      )}
      <Tabs value={tab} onValueChange={(v) => router.replace(`${pathname}${v === 'agency' ? '' : `?tab=${v}`}`, { scroll: false })}>
        <TabsList label="Settings sections" className="mb-5">
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="agency">
          <AgencyTab />
        </TabsContent>
        <TabsContent value="scoring">
          <ScoringTab />
        </TabsContent>
        <TabsContent value="categories">
          <CategoriesTab />
        </TabsContent>
        <TabsContent value="packages">
          <PackagesTab />
        </TabsContent>
        <TabsContent value="team">
          <TeamTab />
        </TabsContent>
        <TabsContent value="integrations">
          <IntegrationsTab />
        </TabsContent>
        <TabsContent value="data">
          <DataTab />
        </TabsContent>
      </Tabs>
    </>
  );
}
