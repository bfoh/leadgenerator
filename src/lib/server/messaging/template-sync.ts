import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { StoreError } from '@/lib/data/store';
import { SupabaseStore, toRow } from '@/lib/data/supabase-store';
import { messagingEnv } from './config';
import type { FetchLike } from './provider';
import { listWhatsAppTemplates } from './whatsapp';

// WhatsApp template status comes only from Meta. The service role writes it (people cannot), and a
// template a person disabled stays disabled. Templates are never created at Meta from here: they
// are written and submitted in WhatsApp Manager, then synchronised.

export async function syncWhatsAppTemplates(serviceSb: SupabaseClient, orgId: string, fetchImpl?: FetchLike) {
  const remote = await listWhatsAppTemplates({
    token: messagingEnv.whatsappToken(),
    businessAccountId: messagingEnv.whatsappBusinessAccountId(),
    graphVersion: messagingEnv.graphVersion(),
    fetchImpl,
  });
  const store = new SupabaseStore(serviceSb, orgId);
  const local = (await store.listTemplates()).filter((t) => t.channel === 'whatsapp');
  const at = new Date().toISOString();
  const counts = { updated: 0, added: 0, missing: 0 };
  for (const r of remote) {
    const match = local.find((t) => t.providerTemplateName === r.name && t.language === r.language);
    const facts = {
      status: r.status,
      statusReason: r.reason ?? (r.status === 'disabled' ? `Meta status ${r.rawStatus}` : null),
      statusCheckedAt: at,
      providerTemplateId: r.id,
      providerCategory: r.category,
      ...(r.body ? { body: r.body } : {}),
    };
    if (match) {
      check(await serviceSb.from('message_templates').update(toRow(facts)).eq('organization_id', orgId).eq('id', match.id));
      counts.updated++;
    } else if (r.body) {
      check(await serviceSb.from('message_templates').insert({
        ...toRow(facts),
        organization_id: orgId,
        channel: 'whatsapp',
        name: r.name,
        purpose: 'introduction',
        language: r.language,
        provider_template_name: r.name,
        body: r.body,
      }));
      counts.added++;
    }
  }
  for (const t of local) {
    if (remote.some((r) => r.name === t.providerTemplateName && r.language === t.language)) continue;
    check(
      await serviceSb
        .from('message_templates')
        .update({ status: t.status === 'disabled' ? 'disabled' : 'draft', status_reason: 'Not found in your WhatsApp Business Account. Create it in WhatsApp Manager with this exact name and language, then synchronise.', status_checked_at: at })
        .eq('organization_id', orgId)
        .eq('id', t.id),
    );
    counts.missing++;
  }
  return counts;
}

function check({ error }: { error: { message: string } | null }) {
  if (error) throw new StoreError(`A template could not be saved: ${error.message.slice(0, 200)}`, 'invalid');
}
