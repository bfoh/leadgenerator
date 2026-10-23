import 'server-only';

import { searchArea, type DiscoveryProvider, type DiscoveryResult } from './discovery';

// Fictional results for exercising the discovery UI without credentials. Names are obviously
// synthetic and every result is flagged isDemo so it can never be mistaken for a real business.

const STEMS = ['Adinkra', 'Sankofa', 'Kente Lane', 'Golden Stool', 'Volta Bay', 'Akwaaba', 'Harmattan', 'Cocoa Hill', 'Lagoon Road', 'Baobab'];

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export const demoProvider: DiscoveryProvider = {
  id: 'demo',
  name: 'Demo provider (fictional data)',
  isConfigured: () => true,
  getCapabilities: () => ({ search: true, details: true, websiteField: true, phoneInDetails: false, emailField: false, maxPageSize: 10, isDemo: true }),
  getAttributionRequirements: () => ({ text: 'Fictional demo data', url: null, notes: 'These businesses do not exist.' }),
  getRetentionRules: () => ({
    storableFields: ['externalId'],
    displayOnlyFields: ['name', 'address', 'websiteUri', 'mapsUri', 'businessStatus', 'primaryType'],
    cacheSeconds: 0,
    policyUrl: null,
    notes: 'Demo results mirror the Google Places rules so the workflow can be practised safely.',
  }),
  estimatedCostUsd: () => 0,

  async search(q) {
    const seed = hash(`${q.city ?? q.region}|${q.category}|${q.neighborhood ?? ''}|${q.terms ?? ''}`);
    const offset = q.pageToken ? Number(q.pageToken) || 0 : 0;
    const count = Math.min(q.limit, 10);
    const results: DiscoveryResult[] = Array.from({ length: count }, (_, i) => {
      const n = (seed + (offset + i) * 7919) >>> 0;
      const stem = STEMS[n % STEMS.length];
      return {
        providerId: 'demo',
        externalId: `demo-${seed.toString(36)}-${offset + i}`,
        name: `DEMO · ${stem} ${q.category} (fictional)`,
        address: `Fictional address, ${searchArea(q)}`,
        websiteUri: n % 3 === 0 ? `https://example.com/demo-${(offset + i).toString()}` : null,
        mapsUri: null,
        businessStatus: n % 11 === 0 ? 'CLOSED_TEMPORARILY' : 'OPERATIONAL',
        primaryType: q.category,
        phone: null,
        isDemo: true,
      };
    });
    return { results, nextPageToken: offset + count < 30 ? String(offset + count) : null };
  },

  async getDetails(externalId) {
    const m = externalId.match(/^demo-[a-z0-9]+-(\d+)$/);
    if (!m) return null;
    return {
      providerId: 'demo',
      externalId,
      name: `DEMO · Fictional business #${m[1]}`,
      address: 'Fictional address',
      websiteUri: null,
      mapsUri: null,
      businessStatus: 'OPERATIONAL',
      primaryType: null,
      phone: null,
      isDemo: true,
    };
  },
};
