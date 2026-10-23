'use client';

import { useQuery } from '@tanstack/react-query';
import { demoMessagingEnv, type DueRunSummary, type MessagingEnv, type SendingControls } from '@/lib/data/messaging-services';
import { DEFAULT_SENDING_POLICY } from '@/lib/domain/sending-policy';
import { agencyIdentityIssues, type MessageStatus } from '@/lib/domain/messaging';
import { api } from './api';
import { useAutomationAvailable, useAutomationSettings } from './automation';
import { useWorkspace } from './workspace-provider';

// Messaging configuration for the browser. Cloud: GET /api/messaging/status (missing settings,
// masked test recipients and their hashes; never values). Demo: the simulated provider, with test
// recipients from Settings → Outreach.

export interface MessagingStatus {
  mode: 'demo' | 'cloud';
  outboundToBusinesses: boolean;
  email: { provider: string; issues: string[]; webhook: boolean };
  whatsapp: { provider: string; graphVersion: string; issues: string[]; webhook: boolean };
  inbound: { organizationConfigured: boolean };
  testRecipients: { hints: string[]; hashes: string[] };
}

export function useMessagingStatus() {
  const { workspace, can } = useWorkspace();
  return useQuery({
    queryKey: ['messaging-status'],
    queryFn: () => api.get<MessagingStatus>('/api/messaging/status'),
    enabled: workspace.mode === 'cloud' && can('outreach.write'),
    staleTime: 60_000,
  });
}

/** The gateway's outside inputs: mode, emergency stop, sending policy and pause, test recipients, sender problems. */
export function useMessagingEnv(): { env: MessagingEnv | null; status: MessagingStatus | null; loading: boolean; error: unknown } {
  const { workspace, ctx } = useWorkspace();
  const available = useAutomationAvailable();
  const settings = useAutomationSettings();
  const status = useMessagingStatus();
  // Without migration 003 there is no mode or stop to read: the most restrictive policy applies.
  const policy: SendingControls | null =
    available.data === false
      ? { mode: 'research_only', outboundStopped: true, sendingPolicy: DEFAULT_SENDING_POLICY, sendingPaused: false }
      : settings.data
        ? { mode: settings.data.mode, outboundStopped: settings.data.outboundStopped, sendingPolicy: settings.data.sendingPolicy, sendingPaused: settings.data.sendingPaused }
        : null;
  const demo = useQuery({
    queryKey: [
      workspace.organizationId,
      'messaging-env',
      policy?.mode,
      policy?.outboundStopped,
      JSON.stringify(policy?.sendingPolicy),
      policy?.sendingPaused,
      ctx.settings.messagingTestRecipients.join(','),
      ctx.settings.agency.name,
      ctx.settings.agency.address,
    ],
    queryFn: () => demoMessagingEnv(ctx, policy!),
    enabled: workspace.mode === 'demo' && Boolean(policy),
  });
  if (workspace.mode === 'demo') return { env: demo.data ?? null, status: null, loading: !demo.data, error: demo.error };
  const s = status.data ?? null;
  const env: MessagingEnv | null =
    policy && s
      ? {
          ...policy,
          outboundAvailable: false,
          testRecipientHashes: s.testRecipients.hashes,
          senderIssues: {
            email: [...s.email.issues, ...agencyIdentityIssues(ctx.settings, 'email')],
            whatsapp: [...s.whatsapp.issues, ...agencyIdentityIssues(ctx.settings, 'whatsapp')],
          },
        }
      : null;
  return { env, status: s, loading: !env && !status.error, error: status.error };
}

export interface ServerDispatchResult {
  status: MessageStatus;
  sandbox: boolean;
  reasons: string[];
  duplicate?: boolean;
  deferred?: boolean;
  scheduledFor?: string | null;
  providerMessageId?: string;
}

export async function dispatchOnServer(messageId: string) {
  return api.post<ServerDispatchResult>('/api/messaging/dispatch', { messageId });
}

export async function dispatchDueOnServer(limit = 10) {
  return api.post<DueRunSummary & { results: (ServerDispatchResult & { messageId: string })[] }>('/api/messaging/dispatch', { due: true, limit });
}

export async function syncTemplatesOnServer() {
  return api.post<{ updated: number; added: number; missing: number }>('/api/messaging/templates/sync', {});
}

