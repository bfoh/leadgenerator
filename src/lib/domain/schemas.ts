// Input validation shared by forms, services and route handlers.

import { z } from 'zod';
import {
  ACTIVITY_TYPES,
  BUDGET_SIGNALS,
  BUSINESS_STATUSES,
  CONFIDENCE_LEVELS,
  CONTACT_PERMISSIONS,
  INTEREST_LEVELS,
  INVOICE_STATUSES,
  LAWFUL_BASES,
  MAINTENANCE_STATUSES,
  PROJECT_STATUSES,
  PROJECT_TYPES,
  SOCIAL_PLATFORMS,
  SOURCE_KINDS,
  VERIFICATION_METHODS,
  VERIFICATION_OUTCOMES,
  type VerificationOutcome,
} from './constants';
import type { Business } from './types';

const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : typeof v === 'string' ? v.trim() : v);

export const optionalText = (max: number) => z.preprocess(blankToNull, z.string().max(max).nullable());
export const optionalUrl = z.preprocess(
  (v) => {
    const s = blankToNull(v);
    // Accept bare domains ("example.com.gh") by assuming https.
    return typeof s === 'string' && !/^[a-z]+:\/\//i.test(s) && /^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(s) ? `https://${s}` : s;
  },
  z.url({ protocol: /^https?$/, message: 'Enter a valid http(s) URL' }).max(2000).nullable(),
);
export const optionalEmail = z.preprocess(blankToNull, z.email({ message: 'Enter a valid email address' }).max(254).nullable());
export const optionalPhone = z.preprocess(
  blankToNull,
  z
    .string()
    .regex(/^\+?[0-9 ()-]{7,20}$/, 'Use digits, spaces, +, - or brackets')
    .nullable(),
);
export const optionalDate = z.preprocess(blankToNull, z.iso.date({ message: 'Use YYYY-MM-DD' }).nullable());

export const socialProfileSchema = z.object({
  platform: z.enum(SOCIAL_PLATFORMS),
  url: z.url({ protocol: /^https?$/ }).max(2000),
});

export const businessFormSchema = z.object({
  name: z.string().trim().min(1, 'Business name is required').max(200),
  category: z.string().trim().min(1, 'Category is required').max(80),
  country: z.string().trim().min(2).max(3),
  region: optionalText(80),
  city: z.string().trim().min(1, 'City is required').max(80),
  neighborhood: optionalText(80),
  address: optionalText(300),
  businessStatus: z.enum(BUSINESS_STATUSES),
  officialWebsite: optionalUrl,
  socialProfiles: z.array(socialProfileSchema).max(12),
  enquiryChannel: optionalText(300),
  phone: optionalPhone,
  email: optionalEmail,
  contactSource: optionalText(500),
  interestLevel: z.enum(INTEREST_LEVELS),
  budgetSignal: z.enum(BUDGET_SIGNALS),
  serviceNeeds: z.array(z.string().trim().min(1).max(120)).max(20),
  estimatedValue: z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number().nonnegative().max(1e9).nullable()),
  expectedCloseDate: optionalDate,
  nextAction: optionalText(300),
  nextActionDue: optionalDate,
  notes: z.string().max(10000),
  sourceUrl: optionalUrl,
  sourceKind: z.enum(SOURCE_KINDS),
  placesPlaceId: optionalText(300),
});
export type BusinessForm = z.infer<typeof businessFormSchema>;

export const permissionFormSchema = z
  .object({
    contactPermission: z.enum(CONTACT_PERMISSIONS),
    lawfulBasis: z.enum(LAWFUL_BASES).nullable(),
    permissionEvidence: optionalText(1000),
  })
  .superRefine((v, ctx) => {
    if (v.contactPermission === 'granted') {
      if (!v.lawfulBasis) ctx.addIssue({ code: 'custom', path: ['lawfulBasis'], message: 'Select the lawful basis for contact' });
      if (!v.permissionEvidence) ctx.addIssue({ code: 'custom', path: ['permissionEvidence'], message: 'Describe how permission was given' });
    }
  });
export type PermissionForm = z.infer<typeof permissionFormSchema>;

export const verificationFormSchema = z
  .object({
    status: z.enum(VERIFICATION_OUTCOMES as [VerificationOutcome, ...VerificationOutcome[]]),
    methods: z.array(z.enum(VERIFICATION_METHODS)).min(1, 'Select at least one method used'),
    domain: optionalText(253),
    sourceUrl: optionalUrl,
    evidenceSummary: z.string().trim().min(10, 'Summarize the evidence (at least 10 characters)').max(4000),
    confidence: z.enum(CONFIDENCE_LEVELS),
    websiteOutdated: z.boolean(),
    nextCheckAt: optionalDate,
  })
  .superRefine((v, ctx) => {
    if (['verified_official', 'potential_official', 'unavailable', 'unhealthy'].includes(v.status) && !v.domain) {
      ctx.addIssue({ code: 'custom', path: ['domain'], message: 'Record the website or domain this outcome refers to' });
    }
    if (v.status === 'none_found' && v.methods.length < 2) {
      ctx.addIssue({ code: 'custom', path: ['methods'], message: '"No official website found" needs at least two documented methods' });
    }
  });
export type VerificationForm = z.infer<typeof verificationFormSchema>;

export const activityFormSchema = z.object({
  type: z.enum(ACTIVITY_TYPES),
  summary: z.string().trim().min(1, 'Add a short summary').max(500),
  details: z.string().max(5000).optional(),
  occurredAt: z.string().optional(),
  scheduledFor: z.preprocess(blankToNull, z.string().nullable()).optional(),
});

export const taskFormSchema = z.object({
  title: z.string().trim().min(1, 'Task title is required').max(300),
  dueDate: optionalDate,
});

export const projectFormSchema = z.object({
  name: z.string().trim().min(1).max(200),
  projectType: z.enum(PROJECT_TYPES),
  status: z.enum(PROJECT_STATUSES),
  contractValue: z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number().nonnegative().max(1e9).nullable()),
  startDate: optionalDate,
  dueDate: optionalDate,
  deploymentUrl: optionalUrl,
  maintenanceStatus: z.enum(MAINTENANCE_STATUSES),
  invoiceStatus: z.enum(INVOICE_STATUSES),
  notes: z.string().max(10000),
});
export type ProjectForm = z.infer<typeof projectFormSchema>;

/** Field errors keyed by path, for accessible form messages. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export function businessToForm(b: Business): z.input<typeof businessFormSchema> {
  return {
    name: b.name,
    category: b.category,
    country: b.country,
    region: b.region ?? '',
    city: b.city,
    neighborhood: b.neighborhood ?? '',
    address: b.address ?? '',
    businessStatus: b.businessStatus,
    officialWebsite: b.officialWebsite ?? '',
    socialProfiles: b.socialProfiles,
    enquiryChannel: b.enquiryChannel ?? '',
    phone: b.phone ?? '',
    email: b.email ?? '',
    contactSource: b.contactSource ?? '',
    interestLevel: b.interestLevel,
    budgetSignal: b.budgetSignal,
    serviceNeeds: b.serviceNeeds,
    estimatedValue: b.estimatedValue ?? '',
    expectedCloseDate: b.expectedCloseDate ?? '',
    nextAction: b.nextAction ?? '',
    nextActionDue: b.nextActionDue ?? '',
    notes: b.notes,
    sourceUrl: b.sourceUrl ?? '',
    sourceKind: b.sourceKind,
    placesPlaceId: b.placesPlaceId ?? '',
  };
}
