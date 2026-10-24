import { describe, expect, it } from 'vitest';
import { ARCHETYPES, archetypeByKey } from '@/lib/domain/archetypes';
import { campaignScopeMatch, campaignScopeSchema } from '@/lib/domain/campaigns';
import {
  DEFAULT_CATEGORIES,
  DEFAULT_FOCUS_CATEGORIES,
  INDUSTRY_CATEGORIES,
  INDUSTRY_GROUPS,
  LEGACY_CATEGORY_LABELS,
  TRACKS,
  groupCategoryLabels,
  placesTypeForCategory,
  searchTermForCategory,
  trackForCategory,
} from '@/lib/domain/categories';
import { DEFAULT_ADD_ONS, DEFAULT_PACKAGES } from '@/lib/domain/packages';
import { PLACES_TYPES, isPlacesType } from '@/lib/domain/places-types';
import { PROPOSAL_TEMPLATES } from '@/lib/domain/proposal-templates';
import { DEFAULT_SETTINGS, categoryGroups } from '@/lib/domain/settings';

// Milestone 3A: the Ghana-wide taxonomy. These tests guard the data contract rather than the copy:
// every saved prospect must still resolve to its old track, every label must stay inside the column
// limit, no Places type may be invented, and a campaign must be able to target a whole industry.

describe('Ghana-wide industry taxonomy', () => {
  it('covers 30 industry groups and more than 300 categories, with no empty group', () => {
    expect(INDUSTRY_GROUPS).toHaveLength(30);
    // 388 categories at the time of writing. Growing the catalogue is fine: update this number and
    // docs/INDUSTRY_TAXONOMY.md together so the reported count never drifts from the data.
    expect(INDUSTRY_CATEGORIES).toHaveLength(388);
    expect(INDUSTRY_CATEGORIES.length).toBeGreaterThanOrEqual(300);
    expect(DEFAULT_CATEGORIES).toHaveLength(INDUSTRY_CATEGORIES.length);
    expect(Object.keys(TRACKS)).toHaveLength(29);
    expect(ARCHETYPES).toHaveLength(22);
    for (const group of INDUSTRY_GROUPS) {
      expect(INDUSTRY_CATEGORIES.filter((category) => category.group === group.key).length, group.label).toBeGreaterThan(0);
    }
  });

  it('keeps every label inside the database column and every id unique and URL-safe', () => {
    const labels = new Set<string>();
    const ids = new Set<string>();
    for (const category of INDUSTRY_CATEGORIES) {
      expect(category.label.length, category.label).toBeGreaterThan(0);
      expect(category.label.length, category.label).toBeLessThanOrEqual(80);
      expect(category.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(labels.has(category.label), `duplicate label ${category.label}`).toBe(false);
      expect(ids.has(category.id), `duplicate id ${category.id}`).toBe(false);
      expect(category.searchTerm.trim().length, category.label).toBeGreaterThan(0);
      labels.add(category.label);
      ids.add(category.id);
    }
  });

  it('preserves all twenty original categories and the track each one resolved to before the expansion', () => {
    const legacyTracks: Record<string, string> = {
      'Fashion boutique': 'fashion',
      "Men's suit retailer": 'fashion',
      'Bridal shop': 'bridal',
      'Furniture showroom': 'furniture',
      'Beauty salon': 'beauty',
      Spa: 'beauty',
      Hotel: 'hospitality',
      Guesthouse: 'hospitality',
      Restaurant: 'food',
      Bakery: 'food',
      'Auto dealership': 'auto',
      'Event planning': 'events',
      'Photography studio': 'creative',
      Gym: 'fitness',
      'Training institution': 'education',
      'Professional services': 'professional',
      Clinic: 'health',
      Hospital: 'health',
      'Herbal clinic': 'health',
      Pharmacy: 'pharmacy',
    };
    expect(LEGACY_CATEGORY_LABELS).toHaveLength(20);
    for (const label of LEGACY_CATEGORY_LABELS) {
      expect(DEFAULT_CATEGORIES.some((category) => category.label === label), label).toBe(true);
      expect(trackForCategory(label), label).toBe(legacyTracks[label]);
    }
    // A saved label with different capitalisation or a slug still resolves to the same category.
    expect(trackForCategory('pharmacy')).toBe('pharmacy');
    expect(trackForCategory('bridal-shop')).toBe('bridal');
    expect(searchTermForCategory('Furniture showroom')).toBe('furniture store');
  });

  it('gives every track report guidance, a proposal template and a real library archetype', () => {
    const tracks = new Set(INDUSTRY_CATEGORIES.map((category) => category.track));
    const archetypes = new Set(ARCHETYPES.map((archetype) => archetype.key));
    const addOns = new Set(DEFAULT_ADD_ONS.map((addOn) => addOn.key));
    const packages = new Set(DEFAULT_PACKAGES.map((pkg) => pkg.key));
    for (const track of tracks) {
      expect(TRACKS[track], track).toBeDefined();
      const template = PROPOSAL_TEMPLATES[track];
      expect(template, track).toBeDefined();
      expect(packages.has(template.basePackage), `${track} package`).toBe(true);
      for (const addOn of template.addOns) expect(addOns.has(addOn.key), `${track}: ${addOn.key}`).toBe(true);
      expect(archetypeByKey(TRACKS[track].archetype), `${track} archetype`).not.toBeNull();
      expect(archetypes.has(TRACKS[track].archetype)).toBe(true);
    }
  });

  it('only uses verified Google Places Table A identifiers, and falls back to text search', () => {
    const allowed = new Set<string>(PLACES_TYPES);
    let mapped = 0;
    for (const category of INDUSTRY_CATEGORIES) {
      for (const type of category.placesTypes) {
        expect(allowed.has(type), `${category.label}: ${type}`).toBe(true);
        expect(isPlacesType(type)).toBe(true);
      }
      if (category.placesTypes.length) mapped++;
      expect(placesTypeForCategory(category.label)).toBe(category.placesTypes[0] ?? null);
    }
    // Coverage should be broad but honest: unmapped categories use the phrase fallback.
    expect(mapped).toBeGreaterThan(INDUSTRY_CATEGORIES.length / 2);
    expect(placesTypeForCategory('Furniture showroom')).toBe('furniture_store');
    expect(placesTypeForCategory('Waakye joint')).toBe('snack_bar');
    expect(placesTypeForCategory('Not a category the taxonomy knows')).toBeNull();
    expect(searchTermForCategory('Not a category the taxonomy knows')).toBe('not a category the taxonomy knows');
  });

  it('understands common Ghanaian trading terms, not only formal category names', () => {
    const localTerms: [string, string][] = [
      ['Waakye joint', 'food'],
      ['Kenkey house', 'food'],
      ['Chop bar', 'food'],
      ['Susu collection & savings', 'finance'],
      ['Trotro & bus operator', 'logistics'],
      ['Kente weaver', 'fashion'],
      ['Small-scale mining operator', 'mining_energy'],
      ['Provision shop', 'retail'],
      ['Fufu joint', 'food'],
      ['Chopbar', 'food'],
    ];
    for (const [term, track] of localTerms) expect(trackForCategory(term), term).toBe(track);

    // Vernacular aliases are attached to the catalogue so a picker search finds them.
    const aliases = new Map(INDUSTRY_CATEGORIES.map((category) => [category.label, category.aliases.join(' ').toLowerCase()]));
    expect(aliases.get('Waakye joint')).toContain('waakye');
    expect(aliases.get('Small-scale mining operator')).toContain('galamsey');
    expect(aliases.get('Susu collection & savings')).toContain('susu');
    expect(aliases.get('Trotro & bus operator')).toContain('trotro');
    expect(aliases.get('Kente weaver')).toContain('kente');

    // A whole group can be researched without choosing one of its categories.
    expect(trackForCategory('Agriculture & Crop Farming')).toBe('agriculture');
    expect(trackForCategory('Nonprofits, Associations & Public Bodies')).toBe('nonprofit');
    expect(searchTermForCategory('Food, Drink & Catering')).toBe('food and drink business');
  });

  it('groups categories for pickers and keeps workspace custom categories last', () => {
    expect(categoryGroups(DEFAULT_SETTINGS)).toHaveLength(30);
    const withCustom = groupCategoryLabels(['Mammy wagon transport', 'Trotro spare parts dealer', 'Mammy wagon transport']);
    expect(withCustom).toHaveLength(31);
    const custom = withCustom[withCustom.length - 1];
    expect(custom.key).toBe('custom');
    expect(custom.label).toBe('Custom categories');
    expect(custom.categories).toEqual(['Mammy wagon transport', 'Trotro spare parts dealer']);
    // A custom label that duplicates a built-in one is not added twice.
    expect(groupCategoryLabels(['Pharmacy'])).toHaveLength(30);
  });

  it('defaults focus categories to the original twenty so existing scores do not jump', () => {
    expect(DEFAULT_SETTINGS.focusCategories).toHaveLength(20);
    expect([...DEFAULT_SETTINGS.focusCategories].sort()).toEqual([...DEFAULT_FOCUS_CATEGORIES].sort());
  });
});
describe('campaign industry targeting', () => {
  const prospect = (category: string) => ({ region: 'Ashanti', districtCode: null, city: 'Kumasi', neighborhood: null, category });

  it('treats a group label as a whole-industry wildcard', () => {
    const scope = { regions: [], districtCodes: [], towns: [], categories: ['Agriculture & Crop Farming'] };
    expect(campaignScopeMatch(prospect('Maize farm'), scope).matched).toBe(true);
    expect(campaignScopeMatch(prospect('Cocoa farm'), scope).matched).toBe(true);
    expect(campaignScopeMatch(prospect('Restaurant'), scope).matched).toBe(false);
    expect(campaignScopeMatch(prospect('Maize farm'), scope).reason).toMatch(/Ashanti/);
  });

  it('keeps a category entry exact rather than widening it to its group', () => {
    const scope = { regions: [], districtCodes: [], towns: [], categories: ['Fashion boutique'] };
    expect(campaignScopeMatch(prospect('Fashion boutique'), scope).matched).toBe(true);
    expect(campaignScopeMatch(prospect('Kente weaver'), scope).matched).toBe(false);
  });

  it('still matches categories the workspace typed itself', () => {
    const scope = { regions: [], districtCodes: [], towns: [], categories: ['Mammy wagon transport'] };
    expect(campaignScopeMatch(prospect('Mammy wagon transport'), scope).matched).toBe(true);
    expect(campaignScopeMatch(prospect('Maize farm'), scope).matched).toBe(false);
  });

  it('accepts every group within the 50-entry cap and refuses 51', () => {
    const groups: string[] = INDUSTRY_GROUPS.map((group) => group.label);
    const build = (categories: string[]) => campaignScopeSchema.safeParse({ regions: [], districtCodes: [], towns: [], categories });
    expect(build(groups).success).toBe(true);
    expect(build(groups.slice(0, 29).concat('Maize farm')).success).toBe(true);
    expect(build(Array.from({ length: 51 }, (_, i) => `Category ${i + 1}`)).success).toBe(false);
  });
});

