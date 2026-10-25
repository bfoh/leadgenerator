import { ok } from '@/lib/server/http';
import { serverEnv } from '@/lib/server/env';
import { isAiConfigured } from '@/lib/server/ai/report-generator';
import { isBackgroundWorkerConfigured } from '@/lib/server/automation/runner';
import { describeProvider } from '@/lib/server/providers/discovery';
import { discoveryProviders } from '@/lib/server/providers/registry';
import { contactProviderStatus } from '@/lib/server/providers/contact-data';
import { braveSearchProvider } from '@/lib/server/providers/web-search';
import { socialDiscoveryStatus } from '@/lib/server/providers/social-discovery';
import { researchToolStatus } from '@/lib/server/research-tools';
import { isSupabaseConfigured } from '@/lib/supabase/config';

export const dynamic = 'force-dynamic';

// Which integrations are configured. Booleans and public policy text only — never secrets.
export async function GET() {
  const cloud = isSupabaseConfigured();
  return ok({
    mode: cloud ? 'cloud' : 'demo',
    serverTools: cloud || serverEnv.demoServerTools(),
    ai: { configured: isAiConfigured(), model: isAiConfigured() ? serverEnv.anthropicModel() : null },
    webSearch: { configured: braveSearchProvider.isConfigured(), name: braveSearchProvider.name },
    discovery: discoveryProviders().map(describeProvider),
    // Autonomous discovery: the only connector is synthetic, and it is off unless explicitly enabled.
    autonomousDiscovery: { syntheticEnabled: serverEnv.discovery.synthetic() },
    // Social profile discovery through a public web index; off unless a workspace enables it.
    socialDiscovery: socialDiscoveryStatus(),
    // Messages to businesses are not possible in this version (only sandbox test recipients, see
    // /api/messaging/status); the flag is reported, never configurable here.
    automation: { backgroundWorker: isBackgroundWorkerConfigured(), outboundSending: false },
    research: researchToolStatus(),
    // Licensed contact-data providers: none is connected in this version.
    contacts: { simulated: serverEnv.simulateExternalTools(), mxLookupQuota: serverEnv.quota.mxLookups(), providers: contactProviderStatus() },
    quotas: {
      discovery: serverEnv.quota.discovery(),
      aiReports: serverEnv.quota.aiReports(),
      websiteChecks: serverEnv.quota.websiteChecks(),
      webSearch: serverEnv.quota.webSearch(),
    },
  });
}
