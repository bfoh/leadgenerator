// Organization settings stored as JSON in organizations.settings (cloud) or the demo store.
// Parsing is tolerant: invalid or missing sections fall back to defaults.

import { z } from 'zod';
import { DEFAULT_CATEGORIES, DEFAULT_FOCUS_CATEGORIES, groupCategoryLabels, type CategoryGroup } from './categories';
import { DEFAULT_ADD_ONS, DEFAULT_PACKAGES, addOnSchema, servicePackageSchema, type ServicePackage } from './packages';
import { DEFAULT_REPORT_MIN_CONFIDENCE } from './report';
import { DEFAULT_WEIGHTS, SCORE_FACTORS, type ScoreWeights } from './scoring';

const weightsSchema = z.object(Object.fromEntries(SCORE_FACTORS.map((f) => [f, z.number().min(0).max(100)])) as Record<
  keyof ScoreWeights,
  z.ZodNumber
>);

/** About 150 KB of image data once base64-encoded. */
export const MAX_LOGO_DATA_URL = 200_000;

export const agencyProfileSchema = z.object({
  name: z.string().max(120),
  email: z.string().max(200),
  phone: z.string().max(60),
  website: z.string().max(300),
  address: z.string().max(300),
  defaultTerms: z.string().max(4000),
  /** Proposal branding. Defaults keep settings saved before these fields existed valid. */
  accentColor: z.union([z.string().regex(/^#[0-9a-f]{6}$/i), z.literal('')]).default(''),
  logoDataUrl: z
    .union([z.string().regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/).max(MAX_LOGO_DATA_URL), z.literal('')])
    .default(''),
});
export type AgencyProfile = z.infer<typeof agencyProfileSchema>;

export const orgSettingsSchema = z.object({
  agency: agencyProfileSchema,
  scoringWeights: weightsSchema,
  focusCategories: z.array(z.string().min(1).max(80)).max(100),
  customCategories: z.array(z.string().min(1).max(80)).max(100),
  packages: z.array(servicePackageSchema).max(30),
  /** Controlled add-on price list used by proposal templates (prices null until the agency sets them). */
  addOns: z.array(addOnSchema).max(60),
  defaultTaxes: z.array(z.object({ label: z.string().min(1).max(80), ratePercent: z.number().min(0).max(100) })).max(10),
  proposalValidityDays: z.number().int().min(1).max(365),
  /** How long a researched contact detail is kept before it must be reviewed or deleted. */
  contactRetentionDays: z.number().int().min(30).max(1095),
  /** Research confidence (0–100) a prospect needs before the agent writes a report automatically. */
  reportMinConfidence: z.number().int().min(0).max(100),
  /**
   * Demo mode only: the agency's own addresses the simulated provider treats as sandbox test
   * recipients. Cloud mode ignores this and reads MESSAGING_TEST_RECIPIENTS on the server.
   */
  messagingTestRecipients: z.array(z.string().trim().min(3).max(320)).max(10),
});
export type OrgSettings = z.infer<typeof orgSettingsSchema>;

export const DEFAULT_SETTINGS: OrgSettings = {
  agency: { name: '', email: '', phone: '', website: '', address: '', defaultTerms: '', accentColor: '', logoDataUrl: '' },
  scoringWeights: DEFAULT_WEIGHTS,
  focusCategories: [...DEFAULT_FOCUS_CATEGORIES],
  customCategories: [],
  packages: DEFAULT_PACKAGES,
  addOns: DEFAULT_ADD_ONS,
  // Ghana tax treatment depends on the agency's registration; nothing is applied by default.
  defaultTaxes: [],
  proposalValidityDays: 30,
  contactRetentionDays: 365,
  reportMinConfidence: DEFAULT_REPORT_MIN_CONFIDENCE,
  messagingTestRecipients: [],
};

export function resolveSettings(raw: unknown): OrgSettings {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: OrgSettings = structuredClone(DEFAULT_SETTINGS);
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof OrgSettings)[]) {
    if (!(key in source)) continue;
    const parsed = orgSettingsSchema.shape[key].safeParse(source[key]);
    if (parsed.success) (out as Record<string, unknown>)[key] = parsed.data;
  }
  return out;
}

export function allCategories(settings: OrgSettings): string[] {
  return [...new Set([...DEFAULT_CATEGORIES.map((c) => c.label), ...settings.customCategories])];
}

/**
 * The same list, grouped by industry, for pickers. Custom categories are appended in their own
 * group so a workspace can still file a business the built-in taxonomy does not name.
 */
export function categoryGroups(settings: OrgSettings): CategoryGroup[] {
  return groupCategoryLabels(settings.customCategories);
}

export function findPackage(settings: OrgSettings, key: string | null | undefined): ServicePackage | null {
  return settings.packages.find((p) => p.key === key) ?? null;
}
