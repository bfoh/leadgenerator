import 'server-only';

import { DISTRICTS } from '@/lib/domain/districts';
import { encodeDiscoveryCursor, decodeDiscoveryCursor, discoveryRequestFingerprint, type DiscoveredRecord, type DiscoveryRequest } from '@/lib/domain/discovery-framework';
import { categoriesInGroup, findIndustryCategory, industryGroupByLabel } from '@/lib/domain/industry-taxonomy';
import { discoverySource } from '@/lib/domain/discovery-sources';
import { serverEnv } from '../env';
import { DiscoveryProviderError, type DiscoveryPage, type DiscoveryProviderAdapter } from './provider';

// A deterministic, offline generator. It is deliberately obvious that the data is synthetic: the
// names say so, every website is on the reserved `.example` domain, and no phone or email exists.
// It never reaches the network and is not evidence about any real market.

const DEFAULT_CATEGORIES = ['Pharmacy', 'Restaurant', 'Hotel', 'Fashion boutique'];
const PER_DISTRICT = 2;
const DISTRICTS_PER_REGION = 2;

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const townOf = (districtName: string) => districtName.replace(/ (Metropolitan|Municipal|District|North|South|East|West)$/i, '').trim() || districtName;

function categoriesFor(request: DiscoveryRequest): string[] {
  const requested = request.categories.length ? request.categories : DEFAULT_CATEGORIES;
  const expanded: string[] = [];
  for (const entry of requested) {
    const category = findIndustryCategory(entry);
    if (category) {
      expanded.push(category.label);
      continue;
    }
    const group = industryGroupByLabel(entry);
    if (group) {
      expanded.push(...categoriesInGroup(group.key).slice(0, 4).map((item) => item.label));
      continue;
    }
    expanded.push(entry);
  }
  return [...new Set(expanded)].slice(0, 8);
}

function buildRecords(request: DiscoveryRequest): DiscoveredRecord[] {
  const regions = request.regions.length ? request.regions : [...new Set(DISTRICTS.map((district) => district.region))].sort();
  const categories = categoriesFor(request);
  const townFilter = new Set(request.towns.map((town) => town.trim().toLowerCase()));
  const records: DiscoveredRecord[] = [];

  for (const region of regions) {
    const inRegion = DISTRICTS.filter((district) => district.region === region).sort((a, b) => a.code.localeCompare(b.code));
    const districts = request.districtCodes.length
      ? inRegion.filter((district) => request.districtCodes.includes(district.code))
      : inRegion.slice(0, DISTRICTS_PER_REGION);
    for (const district of districts) {
      const town = townOf(district.name);
      if (townFilter.size && !townFilter.has(town.toLowerCase()) && !townFilter.has(district.name.toLowerCase())) continue;
      for (const category of categories) {
        for (let index = 1; index <= PER_DISTRICT; index += 1) {
          const id = `syn-${district.code.toLowerCase()}-${slug(category)}-${index}`;
          records.push({
            sourceId: 'offline_synthetic',
            providerRecordId: id,
            name: `${category} ${town} ${index} (synthetic)`,
            category,
            address: `${index} Synthetic Street, ${town}`,
            region,
            districtCode: district.code,
            town,
            website: `https://synthetic.example/${id}`,
            phone: null,
            email: null,
            operatingStatus: 'open',
            confidence: 0.9,
            sourceUrl: null,
            retrievedAt: new Date().toISOString(),
          });
        }
      }
    }
  }
  return records.sort((a, b) => a.providerRecordId.localeCompare(b.providerRecordId));
}

export const offlineSyntheticProvider: DiscoveryProviderAdapter = {
  id: 'offline_synthetic',
  declaration: discoverySource('offline_synthetic')!,
  isEnabled: () => serverEnv.discovery.synthetic(),
  async search(request, signal): Promise<DiscoveryPage> {
    signal.throwIfAborted();
    if (!this.isEnabled()) throw new DiscoveryProviderError('The offline synthetic provider is disabled.', 'forbidden');
    const fingerprint = discoveryRequestFingerprint(request);
    const offset = request.cursor ? decodeDiscoveryCursor(request.cursor, fingerprint) : 0;
    if (offset === null || !Number.isFinite(offset) || offset < 0) {
      throw new DiscoveryProviderError('The discovery cursor does not belong to this search.', 'invalid');
    }
    const all = buildRecords(request);
    const pageSize = Math.min(request.pageSize, this.declaration.limits.maxPageSize);
    const page = all.slice(offset, offset + pageSize);
    const next = offset + page.length < all.length ? encodeDiscoveryCursor(offset + page.length, fingerprint) : null;
    return { records: page, nextCursor: next };
  },
};
