import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import type { Role } from '@/lib/domain/constants';
import { can, type Capability } from '@/lib/domain/permissions';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { serverSupabase } from '@/lib/supabase/server';
import { serverEnv } from './env';
import { HttpError, clientIp } from './http';
import { rateLimit } from './rate-limit';

export type RequestContext =
  | { mode: 'demo'; key: string }
  | { mode: 'cloud'; key: string; userId: string; orgId: string; role: Role; supabase: SupabaseClient }
  /** The scheduled automation worker: service-role client, scoped to one organization per run. */
  | { mode: 'worker'; key: string; userId: null; orgId: string; role: null; supabase: SupabaseClient };

/**
 * Authenticates a route-handler request and checks the caller's role.
 * Demo mode (no Supabase) is allowed only in development or with DEMO_SERVER_TOOLS=true.
 */
export async function requireContext(req: NextRequest, capability: Capability, limit = { count: 30, windowMs: 60_000 }): Promise<RequestContext> {
  // Cookie-authenticated writes must come from this origin (defence in depth beyond SameSite).
  const origin = req.headers.get('origin');
  if (req.method !== 'GET' && origin) {
    let sameOrigin = false;
    try {
      sameOrigin = new URL(origin).host === req.headers.get('host');
    } catch {
      sameOrigin = false;
    }
    if (!sameOrigin) throw new HttpError(403, 'Cross-origin requests are not allowed.');
  }
  let ctx: RequestContext;
  if (!isSupabaseConfigured()) {
    if (!serverEnv.demoServerTools()) {
      throw new HttpError(403, 'Server tools are disabled on public demo deployments. Configure Supabase sign-in, or set DEMO_SERVER_TOOLS=true on a private deployment.');
    }
    ctx = { mode: 'demo', key: `demo:${clientIp(req)}` };
  } else {
    const supabase = await serverSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new HttpError(401, 'Sign in to use this feature.');
    const { data, error } = await supabase
      .from('organization_members')
      .select('organization_id, role')
      .eq('user_id', user.id)
      .order('created_at')
      .limit(1)
      .maybeSingle();
    if (error || !data) throw new HttpError(403, 'No workspace membership found. Reload the app to finish setting up your workspace.');
    if (!can(data.role as Role, capability)) throw new HttpError(403, 'Your role does not allow this action.');
    ctx = { mode: 'cloud', key: `user:${user.id}`, userId: user.id, orgId: data.organization_id as string, role: data.role as Role, supabase };
  }
  const rl = rateLimit(`${capability}:${ctx.key}`, limit.count, limit.windowMs);
  if (!rl.allowed) throw new HttpError(429, `Too many requests. Try again in ${rl.retryAfterSeconds}s.`);
  return ctx;
}
