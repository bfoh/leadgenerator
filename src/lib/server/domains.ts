import 'server-only';

import { lookup } from 'node:dns/promises';
import { isPrivateAddress } from './safe-fetch';

export { candidateDomains } from '@/lib/domain/web-research';

export async function probeDomain(domain: string): Promise<{ domain: string; resolves: boolean; note: string }> {
  try {
    const result = await Promise.race([
      lookup(domain, { all: true }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);
    const publicAddresses = result.filter((a) => !isPrivateAddress(a.address));
    return publicAddresses.length
      ? { domain, resolves: true, note: 'Resolves — ownership unknown. Check the site before recording it.' }
      : { domain, resolves: false, note: 'Resolves only to reserved addresses.' };
  } catch {
    return { domain, resolves: false, note: 'Does not resolve.' };
  }
}
