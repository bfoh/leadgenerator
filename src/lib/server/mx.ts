import 'server-only';

import { Resolver } from 'node:dns/promises';
import type { MxResult } from '@/lib/domain/contacts';

// Mail-server (MX) lookups for email domains. DNS only: no connection is ever made to a mail
// server, so no mailbox is probed (an MX record does not prove a mailbox exists).

const TIMEOUT_MS = 4000;

const code = (e: unknown) => (e as { code?: string }).code ?? '';

export async function lookupMx(domain: string): Promise<MxResult> {
  const resolver = new Resolver({ timeout: TIMEOUT_MS, tries: 2 });
  const timer = setTimeout(() => resolver.cancel(), TIMEOUT_MS * 2);
  try {
    const records = await resolver.resolveMx(domain);
    // RFC 7505 null MX: a single record with an empty exchange says the domain takes no email.
    if (records.length === 1 && (records[0].exchange === '' || records[0].exchange === '.')) return { domain, status: 'null_mx', hosts: [] };
    const hosts = records.sort((a, b) => a.priority - b.priority).map((r) => r.exchange.toLowerCase());
    return hosts.length ? { domain, status: 'found', hosts: hosts.slice(0, 5) } : { domain, status: 'no_mx_but_resolves', hosts: [] };
  } catch (e) {
    if (code(e) === 'ENOTFOUND') return { domain, status: 'no_domain', hosts: [] };
    if (code(e) === 'ENODATA') {
      // No MX: mail falls back to the domain's address records (RFC 5321 §5.1).
      try {
        const [v4, v6] = await Promise.allSettled([resolver.resolve4(domain), resolver.resolve6(domain)]);
        const resolves = (v4.status === 'fulfilled' && v4.value.length > 0) || (v6.status === 'fulfilled' && v6.value.length > 0);
        return { domain, status: resolves ? 'no_mx_but_resolves' : 'no_domain', hosts: [] };
      } catch {
        return { domain, status: 'error', hosts: [] };
      }
    }
    return { domain, status: 'error', hosts: [] };
  } finally {
    clearTimeout(timer);
  }
}
