import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL } from './config';

// Service-role client. It bypasses RLS, so it is used only where the database reserves a write for
// the server: the scheduled automation worker, provider webhooks and unsubscribe links (no signed-in
// user), and the worker-only writes of a message dispatch, after the request has read the message
// with the user's own client and passed the eligibility gateway. Every query made with it is scoped
// to one organization (SupabaseStore / SupabaseAutomationStore).

export function serviceRoleKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}

export function serviceSupabase(): SupabaseClient {
  const key = serviceRoleKey();
  if (!SUPABASE_URL || !key) throw new Error('The service-role client is not configured (SUPABASE_SERVICE_ROLE_KEY).');
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
