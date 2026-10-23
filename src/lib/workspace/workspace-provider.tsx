'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { createContext, useContext, useMemo } from 'react';
import { LocalAutomationStore } from '@/lib/automation/local-store';
import type { AutomationStore } from '@/lib/automation/store';
import { SupabaseAutomationStore } from '@/lib/automation/supabase-store';
import { LocalStore, DEMO_ORG_ID, DEMO_USER_ID } from '@/lib/data/local-store';
import type { ServiceContext } from '@/lib/data/services';
import type { DataStore } from '@/lib/data/store';
import { SupabaseStore } from '@/lib/data/supabase-store';
import type { Role } from '@/lib/domain/constants';
import { can, type Capability } from '@/lib/domain/permissions';
import type { OrgSettings } from '@/lib/domain/settings';
import type { Workspace } from '@/lib/domain/types';
import { browserSupabase } from '@/lib/supabase/client';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { errorMessage } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PageSkeleton } from '@/components/ui/misc';

interface WorkspaceValue {
  workspace: Workspace;
  store: DataStore;
  automation: AutomationStore;
  settings: OrgSettings;
  ctx: ServiceContext;
  can: (capability: Capability) => boolean;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

let demoStore: LocalStore | null = null;
function getDemoStore() {
  demoStore ??= new LocalStore(typeof window === 'undefined' ? null : window.localStorage);
  return demoStore;
}

async function connect(): Promise<{ workspace: Workspace; store: DataStore; automation: AutomationStore }> {
  if (!isSupabaseConfigured()) {
    const store = getDemoStore();
    return {
      store,
      automation: new LocalAutomationStore(typeof window === 'undefined' ? null : window.localStorage),
      workspace: { mode: 'demo', organizationId: DEMO_ORG_ID, organizationName: store.organizationName(), userId: DEMO_USER_ID, email: null, role: 'owner' },
    };
  }
  const sb = browserSupabase()!;
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    window.location.assign(new URL(`/login?next=${encodeURIComponent(window.location.pathname)}`, window.location.origin));
    throw new Error('Signing you in…');
  }
  const { data, error } = await sb.rpc('ensure_workspace');
  if (error) throw new Error(`Could not open your workspace: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as { org_id: string; org_name: string; member_role: Role } | undefined;
  if (!row) throw new Error('No workspace is available for this account.');
  return {
    store: new SupabaseStore(sb, row.org_id),
    automation: new SupabaseAutomationStore(sb, row.org_id),
    workspace: { mode: 'cloud', organizationId: row.org_id, organizationName: row.org_name, userId: user.id, email: user.email ?? null, role: row.member_role },
  };
}

/** Loads the workspace (demo browser store or Supabase organization) and its settings. */
export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const session = useQuery({ queryKey: ['workspace'], queryFn: connect, staleTime: Infinity, retry: false });
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => session.data!.store.getSettings(),
    enabled: Boolean(session.data),
    staleTime: Infinity,
  });

  const value = useMemo<WorkspaceValue | null>(() => {
    if (!session.data || !settings.data) return null;
    const { workspace, store, automation } = session.data;
    const label = workspace.mode === 'demo' ? 'Demo user' : (workspace.email ?? 'Team member');
    return {
      workspace: { ...workspace, organizationName: store instanceof LocalStore ? store.organizationName() : workspace.organizationName },
      store,
      automation,
      settings: settings.data,
      ctx: { store, settings: settings.data, userId: workspace.userId, userLabel: label },
      can: (capability) => can(workspace.role, capability),
    };
  }, [session.data, settings.data]);

  const error = session.error ?? settings.error;
  if (error) {
    return (
      <div className="mx-auto mt-24 max-w-md px-4 text-center">
        <AlertTriangle className="mx-auto mb-3 size-6 text-warning" aria-hidden />
        <h1 className="text-base font-semibold">Workspace unavailable</h1>
        <p className="mt-2 text-sm text-subtle">{errorMessage(error)}</p>
        <Button className="mt-5" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </div>
    );
  }
  if (!value) {
    return (
      <div className="p-6">
        <PageSkeleton />
      </div>
    );
  }
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return value;
}
