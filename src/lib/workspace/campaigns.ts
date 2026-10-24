'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CampaignRun, CampaignScope, CampaignStatus, CampaignSummary, CampaignTarget, ResearchCampaign } from '@/lib/domain/campaigns';
import { api } from './api';
import { useWorkspace } from './workspace-provider';

/** A campaign job as the detail endpoint returns it. */
export interface CampaignJobView {
  id: string;
  agent: string;
  status: 'pending' | 'running' | 'awaiting_approval' | 'succeeded' | 'failed' | 'cancelled';
  businessId: string | null;
  campaignTargetId: string | null;
  estimatedCostUsd: number;
  lastError: string | null;
  errorKind: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface CampaignBusinessView {
  id: string;
  name: string;
  region: string | null;
  city: string | null;
  category: string;
  opportunityScore: number | null;
}

export interface CampaignDetail {
  campaign: ResearchCampaign;
  targets: CampaignTarget[];
  runs: CampaignRun[];
  jobs: CampaignJobView[];
  businesses: CampaignBusinessView[];
  spendUsd: number;
  activity: { researching: number; openJobs: number };
}

export interface CampaignPreview {
  matched: number;
  excluded: number;
  sample: { id: string; name: string; region: string | null; city: string | null; category: string; reason: string }[];
}

export interface CampaignTickResult {
  campaignId: string;
  status: 'succeeded' | 'failed' | 'skipped';
  enqueued: number;
  completed: number;
  openJobs: number;
  spendUsd: number;
  note: string;
}

export interface CampaignWriteBody {
  name: string;
  description: string | null;
  providerKey: string;
  scope: CampaignScope;
  batchSize: number;
  dailyTargetLimit: number;
  monthlyBudgetUsd: number | null;
  schedule: { frequency: ResearchCampaign['schedule']['frequency']; hour: number; weekday: number | null; day: number | null };
  autoComplete: boolean;
}

export const campaignApi = {
  list: () => api.get<{ campaigns: CampaignSummary[] }>('/api/campaigns'),
  detail: (id: string) => api.get<CampaignDetail>(`/api/campaigns/${id}`),
  create: (body: CampaignWriteBody) => api.post<{ campaign: ResearchCampaign }>('/api/campaigns', body),
  update: (id: string, body: Partial<CampaignWriteBody> & { status?: CampaignStatus; pausedReason?: string | null }) =>
    api.patch<{ campaign: ResearchCampaign }>(`/api/campaigns/${id}`, body),
  run: (id: string) => api.post<{ result: CampaignTickResult }>(`/api/campaigns/${id}/run`, {}),
  remove: (id: string) => api.del<{ deleted: true }>(`/api/campaigns/${id}`),
  preview: (scope: CampaignScope) => api.post<CampaignPreview>('/api/campaigns/preview', { scope }),
};

export function campaignKeys(organizationId: string) {
  return {
    all: [organizationId, 'campaigns'] as const,
    detail: (id: string) => [organizationId, 'campaigns', id] as const,
  };
}

/** Campaign list, refreshed while the Automation Center is open. */
export function useCampaigns() {
  const { workspace } = useWorkspace();
  return useQuery({
    queryKey: campaignKeys(workspace.organizationId).all,
    queryFn: campaignApi.list,
    enabled: workspace.mode === 'cloud',
    refetchInterval: 15_000,
    retry: false,
  });
}

export function useCampaignDetail(id: string | null) {
  const { workspace } = useWorkspace();
  return useQuery({
    queryKey: campaignKeys(workspace.organizationId).detail(id ?? 'none'),
    queryFn: () => campaignApi.detail(id!),
    enabled: workspace.mode === 'cloud' && Boolean(id),
    refetchInterval: 10_000,
    retry: false,
  });
}

export function useCampaignRefresh() {
  const queryClient = useQueryClient();
  const { workspace } = useWorkspace();
  return () => queryClient.invalidateQueries({ queryKey: [workspace.organizationId, 'campaigns'] });
}
