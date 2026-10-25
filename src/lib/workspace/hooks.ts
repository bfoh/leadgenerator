'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ServiceContext } from '@/lib/data/services';
import type { DataStore } from '@/lib/data/store';
import { errorMessage } from '@/lib/utils';
import { useWorkspace } from './workspace-provider';

function useStoreQuery<T>(key: readonly unknown[], fn: (store: DataStore) => Promise<T>, enabled = true) {
  const { store, workspace } = useWorkspace();
  return useQuery({ queryKey: [workspace.organizationId, ...key], queryFn: () => fn(store), enabled });
}

export const useBusinesses = () => useStoreQuery(['businesses'], (s) => s.listBusinesses());
export const useBusiness = (id: string) => useStoreQuery(['business', id], (s) => s.getBusiness(id));
export const useVerifications = (businessId?: string) => useStoreQuery(['verifications', businessId ?? 'all'], (s) => s.listVerifications(businessId));
export const useActivities = (businessId?: string) => useStoreQuery(['activities', businessId ?? 'all'], (s) => s.listActivities(businessId));
export const useTasks = () => useStoreQuery(['tasks'], (s) => s.listTasks());
export const useReports = (businessId?: string) => useStoreQuery(['reports', businessId ?? 'all'], (s) => s.listReports(businessId));
export const useProposals = () => useStoreQuery(['proposals'], (s) => s.listProposals());
export const useProposal = (id: string) => useStoreQuery(['proposal', id], (s) => s.getProposal(id));
export const useProposalVersions = (id: string) => useStoreQuery(['proposal-versions', id], (s) => s.listProposalVersions(id));
export const useProjects = () => useStoreQuery(['projects'], (s) => s.listProjects());
export const useMilestones = (projectId?: string) => useStoreQuery(['milestones', projectId ?? 'all'], (s) => s.listMilestones(projectId));
export const useAuditEvents = (recordId: string | null) => useStoreQuery(['audit', recordId], (s) => s.listAuditEvents(recordId!), Boolean(recordId));
export const useUsage = (sinceIso: string) => useStoreQuery(['usage', sinceIso], (s) => s.listUsage(sinceIso));
export const useMembers = () => useStoreQuery(['members'], (s) => s.listMembers());
export const useInvitations = () => useStoreQuery(['invitations'], (s) => s.listInvitations());
/** Whether migration 004 (agent evidence, identity, audit findings, score overrides) is applied. */
export const useResearchSchema = () => useStoreQuery(['research-schema'], (s) => s.researchSchemaAvailable());
export const useIdentityLinks = (businessId?: string) => useStoreQuery(['identity-links', businessId ?? 'all'], (s) => s.listIdentityLinks(businessId));
export const useAuditFindings = (businessId?: string) => useStoreQuery(['audit-findings', businessId ?? 'all'], (s) => s.listAuditFindings(businessId));
/** Whether migration 005 (contact points, consent records, suppression list) is applied. */
export const useContactSchema = () => useStoreQuery(['contact-schema'], (s) => s.contactSchemaAvailable());
export const useContactPoints = (businessId?: string, enabled = true) => useStoreQuery(['contact-points', businessId ?? 'all'], (s) => s.listContactPoints(businessId), enabled);
export const useConsentRecords = (businessId?: string, enabled = true) => useStoreQuery(['consent-records', businessId ?? 'all'], (s) => s.listConsentRecords(businessId), enabled);
export const useSuppressions = (enabled = true) => useStoreQuery(['suppressions'], (s) => s.listSuppressions(), enabled);

export const useMessagingSchema = () => useStoreQuery(['messaging-schema'], (s) => s.messagingSchemaAvailable());
export const useTemplates = (enabled = true) => useStoreQuery(['message-templates'], (s) => s.listTemplates(), enabled);
export const useOutreachMessages = (businessId?: string, enabled = true) => useStoreQuery(['outreach-messages', businessId ?? 'all'], (s) => s.listOutreachMessages(businessId), enabled);
export const useDecisions = (messageId: string | null) => useStoreQuery(['eligibility-decisions', messageId], (s) => s.listDecisions(messageId!), Boolean(messageId));
export const useInboundMessages = (businessId?: string, enabled = true) => useStoreQuery(['inbound-messages', businessId ?? 'all'], (s) => s.listInboundMessages(businessId), enabled);
/** Whether migration 007 (message policies, sending policy) is applied. */
export const useSendingSchema = () => useStoreQuery(['sending-schema'], (s) => s.sendingSchemaAvailable());
export const useMessagePolicies = (enabled = true) => useStoreQuery(['message-policies'], (s) => s.listMessagePolicies(), enabled);
/** Whether migration 008 (reply classifications, proposal change requests) is applied. */
export const useConversionSchema = () => useStoreQuery(['conversion-schema'], (s) => s.conversionSchemaAvailable());
/** Every reading, or those of the given received messages. */
export const useReplyClassifications = (inboundIds?: readonly string[], enabled = true) =>
  useStoreQuery(['reply-classifications', inboundIds ? inboundIds.join(',') : 'all'], (s) => s.listReplyClassifications(inboundIds), enabled);
export const useChangeRequests = (businessId?: string, enabled = true) => useStoreQuery(['change-requests', businessId ?? 'all'], (s) => s.listChangeRequests(businessId), enabled);
/** Whether migration 012 (website concepts, brand evidence, reviews) is applied. */
export const useStudioSchema = () => useStoreQuery(['studio-schema'], (s) => s.studioSchemaAvailable());
export const useStudioProjects = (businessId?: string) => useStoreQuery(['studio-projects', businessId ?? 'all'], (s) => s.listStudioProjects(businessId));
export const useStudioProject = (id: string) => useStoreQuery(['studio-project', id], (s) => s.getStudioProject(id));
export const useStudioObservations = (projectId?: string) => useStoreQuery(['studio-observations', projectId ?? 'all'], (s) => s.listStudioObservations(projectId));
export const useStudioReviews = (projectId?: string) => useStoreQuery(['studio-reviews', projectId ?? 'all'], (s) => s.listStudioReviews(projectId));
/** Whether migration 013 (asset vault, Brand Kit, private bucket) is applied. */
export const useAssetVaultSchema = () => useStoreQuery(['asset-vault-schema'], (s) => s.assetVaultAvailable());
export const useStudioAssets = (projectId?: string) => useStoreQuery(['studio-assets', projectId ?? 'all'], (s) => s.listStudioAssets(projectId));
export const useStudioAssetEvents = (projectId?: string) => useStoreQuery(['studio-asset-events', projectId ?? 'all'], (s) => s.listStudioAssetEvents(projectId));
export const useStudioAssetReferences = (projectId?: string) => useStoreQuery(['studio-asset-references', projectId ?? 'all'], (s) => s.listStudioAssetReferences(projectId));
/** Whether migration 014 (creative briefs, directions, reviews) is applied. */
export const useCreativeDirectionSchema = () => useStoreQuery(['creative-direction-schema'], (s) => s.creativeDirectionSchemaAvailable());
/** Immutable brief versions, newest first. */
export const useCreativeBriefs = (projectId: string) => useStoreQuery(['creative-briefs', projectId], (s) => s.listStudioCreativeBriefs(projectId));
export const useCreativeBriefReviews = (projectId: string) => useStoreQuery(['creative-brief-reviews', projectId], (s) => s.listStudioCreativeBriefReviews(projectId));
/** Immutable direction versions, newest first. */
export const useCreativeDirections = (projectId: string) => useStoreQuery(['creative-directions', projectId], (s) => s.listStudioCreativeDirections(projectId));
export const useCreativeDirectionReviews = (projectId: string) => useStoreQuery(['creative-direction-reviews', projectId], (s) => s.listStudioCreativeDirectionReviews(projectId));
/** Whether migration 015 (rendered website prototypes) is applied. */
export const useWebsitePrototypeSchema = () => useStoreQuery(['website-prototype-schema'], (s) => s.websitePrototypeSchemaAvailable());
/** Immutable rendered blueprint versions, newest first. */
export const useStudioWebsitePrototypes = (projectId: string) => useStoreQuery(['studio-website-prototypes', projectId], (s) => s.listStudioWebsitePrototypes(projectId));
/** The kit with its immutable versions and append-only approvals, newest first. */
export const useStudioBrandKit = (projectId: string) =>
  useStoreQuery(['studio-brand-kit', projectId], async (s) => {
    const kit = await s.getStudioBrandKit(projectId);
    if (!kit) return null;
    const [versions, approvals] = await Promise.all([s.listStudioBrandKitVersions(kit.id), s.listStudioBrandKitApprovals(kit.id)]);
    return { kit, versions, approvals };
  });
export const useAuditTrail = (tables: string[], enabled = true) => useStoreQuery(['audit-trail', tables.join(',')], (s) => s.listAuditTrail(tables), enabled);

// Session and server configuration do not change when records do.
const STATIC_KEYS = new Set(['workspace', 'server-status', 'messaging-status']);

/**
 * Runs a service operation, refreshes every query (writes often touch several tables, e.g. a
 * verification also rescores the business and logs activity) and reports the outcome.
 */
export function useAction<A extends unknown[], R>(
  fn: (ctx: ServiceContext, ...args: A) => Promise<R>,
  options: { success?: string | ((result: R) => string); onSuccess?: (result: R) => void } = {},
) {
  const { ctx } = useWorkspace();
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (args: A) => fn(ctx, ...args),
    onSuccess: async (result) => {
      await qc.invalidateQueries({ predicate: (q) => !STATIC_KEYS.has(String(q.queryKey[0])) });
      const message = typeof options.success === 'function' ? options.success(result) : options.success;
      if (message) toast.success(message);
      options.onSuccess?.(result);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return {
    /** Resolves to the result, or undefined if it failed (the error is already shown). */
    run: async (...args: A): Promise<R | undefined> => {
      try {
        return await mutation.mutateAsync(args);
      } catch {
        return undefined;
      }
    },
    pending: mutation.isPending,
  };
}
