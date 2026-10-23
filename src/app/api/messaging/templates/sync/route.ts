import type { NextRequest } from 'next/server';
import { requireContext } from '@/lib/server/context';
import { HttpError, fail, ok } from '@/lib/server/http';
import { messagingEnv } from '@/lib/server/messaging/config';
import { syncWhatsAppTemplates } from '@/lib/server/messaging/template-sync';
import { serviceRoleKey, serviceSupabase } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

// Reads template names, languages, categories, bodies and review status from the WhatsApp Business
// Account. Read-only at Meta; free of charge. Owners and admins only.
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireContext(req, 'templates.manage', { count: 6, windowMs: 60_000 });
    if (ctx.mode !== 'cloud') throw new HttpError(400, 'Template synchronisation needs cloud mode and a WhatsApp Business Account.');
    if (!messagingEnv.whatsappToken() || !/^\d{5,20}$/.test(messagingEnv.whatsappBusinessAccountId())) {
      throw new HttpError(503, 'Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_BUSINESS_ACCOUNT_ID on the server first.');
    }
    if (!serviceRoleKey()) throw new HttpError(503, 'Template synchronisation needs SUPABASE_SERVICE_ROLE_KEY on the server.');
    try {
      return ok(await syncWhatsAppTemplates(serviceSupabase(), ctx.orgId));
    } catch (error) {
      throw new HttpError(502, `WhatsApp templates could not be read: ${error instanceof Error ? error.message.slice(0, 200) : 'unknown error'}`);
    }
  } catch (error) {
    return fail(error);
  }
}
