// Shared vocabularies. Database CHECK constraints in supabase/migrations/002 mirror these lists —
// change both together.

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

function labels<K extends string>(entries: Record<K, string>) {
  return entries;
}

export const STAGES = [
  'research_candidate',
  'verification_pending',
  'qualified',
  'introduction_requested',
  'contact_authorized',
  'discovery_meeting',
  'proposal_draft',
  'proposal_sent',
  'negotiation',
  'won',
  'lost',
  'archived',
] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS = labels<Stage>({
  research_candidate: 'Research candidate',
  verification_pending: 'Verification pending',
  qualified: 'Qualified',
  introduction_requested: 'Introduction requested',
  contact_authorized: 'Contact authorized',
  discovery_meeting: 'Discovery meeting',
  proposal_draft: 'Proposal draft',
  proposal_sent: 'Proposal sent',
  negotiation: 'Negotiation',
  won: 'Won',
  lost: 'Lost',
  archived: 'Archived',
});

/** Stages that involve direct contact with the business and therefore need permission. */
export const PERMISSION_STAGES: readonly Stage[] = ['contact_authorized', 'discovery_meeting', 'proposal_sent', 'negotiation'];
export const CLOSED_STAGES: readonly Stage[] = ['won', 'lost', 'archived'];

export const WEBSITE_STATUSES = [
  'unverified',
  'verified_official',
  'potential_official',
  'unavailable',
  'unhealthy',
  'none_found',
  'insufficient_evidence',
] as const;
export type WebsiteStatus = (typeof WEBSITE_STATUSES)[number];
export type VerificationOutcome = Exclude<WebsiteStatus, 'unverified'>;
export const VERIFICATION_OUTCOMES = WEBSITE_STATUSES.filter((s): s is VerificationOutcome => s !== 'unverified');

export const WEBSITE_STATUS_META: Record<WebsiteStatus, { label: string; description: string; tone: Tone }> = {
  unverified: { label: 'Not yet verified', description: 'No documented website research yet.', tone: 'neutral' },
  verified_official: { label: 'Verified official website', description: 'Ownership confirmed from independent evidence.', tone: 'info' },
  potential_official: { label: 'Potential official website', description: 'A likely site exists but ownership is unconfirmed.', tone: 'warning' },
  unavailable: { label: 'Website unavailable', description: 'An identified site does not respond or has lapsed.', tone: 'accent' },
  unhealthy: { label: 'Website technically unhealthy', description: 'Site responds but has errors, no HTTPS, or poor mobile support.', tone: 'accent' },
  none_found: { label: 'No official website found', description: 'No official site discovered after documented checks. Not proof of absence.', tone: 'success' },
  insufficient_evidence: { label: 'Insufficient evidence', description: 'Checks so far are inconclusive.', tone: 'neutral' },
};

export const VERIFICATION_METHODS = [
  'exact_name_search',
  'name_variation_search',
  'domain_probe',
  'social_profile_review',
  'http_check',
  'redirect_check',
  'technical_health',
  'manual_review',
] as const;
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];
export const VERIFICATION_METHOD_LABELS = labels<VerificationMethod>({
  exact_name_search: 'Searched exact business name + city',
  name_variation_search: 'Searched name variations',
  domain_probe: 'Checked candidate domains',
  social_profile_review: 'Reviewed business-declared social profiles',
  http_check: 'Checked the website responds',
  redirect_check: 'Checked redirects',
  technical_health: 'Checked basic technical health',
  manual_review: 'Manual review',
});

export const CONFIDENCE_LEVELS = ['low', 'medium', 'high'] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

export const BUSINESS_STATUSES = ['unknown', 'active', 'inactive'] as const;
export type BusinessStatus = (typeof BUSINESS_STATUSES)[number];
export const BUSINESS_STATUS_LABELS = labels<BusinessStatus>({
  unknown: 'Operating status unknown',
  active: 'Confirmed operating',
  inactive: 'Appears inactive / closed',
});

export const CONTACT_PERMISSIONS = ['unknown', 'introduction_requested', 'granted', 'declined', 'opted_out'] as const;
export type ContactPermission = (typeof CONTACT_PERMISSIONS)[number];
export const CONTACT_PERMISSION_META: Record<ContactPermission, { label: string; tone: Tone }> = {
  unknown: { label: 'Permission not established', tone: 'neutral' },
  introduction_requested: { label: 'Introduction requested', tone: 'warning' },
  granted: { label: 'Permission granted', tone: 'success' },
  declined: { label: 'Declined contact', tone: 'danger' },
  opted_out: { label: 'Opted out — do not contact', tone: 'danger' },
};

export const LAWFUL_BASES = ['consent', 'business_initiated', 'existing_relationship'] as const;
export type LawfulBasis = (typeof LAWFUL_BASES)[number];
export const LAWFUL_BASIS_LABELS = labels<LawfulBasis>({
  consent: 'Consent obtained from the business',
  business_initiated: 'Business contacted us first',
  existing_relationship: 'Existing client relationship',
});

export const INTEREST_LEVELS = ['unknown', 'none', 'low', 'medium', 'high'] as const;
export type InterestLevel = (typeof INTEREST_LEVELS)[number];
export const INTEREST_LABELS = labels<InterestLevel>({
  unknown: 'Unknown',
  none: 'Not interested',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
});

export const BUDGET_SIGNALS = ['unknown', 'limited', 'adequate', 'strong'] as const;
export type BudgetSignal = (typeof BUDGET_SIGNALS)[number];
export const BUDGET_LABELS = labels<BudgetSignal>({
  unknown: 'Unknown',
  limited: 'Limited (stated by business)',
  adequate: 'Adequate (stated by business)',
  strong: 'Strong (stated by business)',
});

export const SOURCE_KINDS = ['manual', 'directory', 'search', 'direct_submission', 'referral', 'places_reference', 'legacy_seed'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
export const SOURCE_KIND_LABELS = labels<SourceKind>({
  manual: 'Manual research',
  directory: 'Business directory',
  search: 'Web search',
  direct_submission: 'Submitted by the business',
  referral: 'Referral',
  places_reference: 'Google Places reference (ID only)',
  legacy_seed: 'v1–v3 seed research',
});

export const SOCIAL_PLATFORMS = ['facebook', 'instagram', 'tiktok', 'x', 'linkedin', 'youtube', 'whatsapp_business', 'other'] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const ACTIVITY_TYPES = [
  'note',
  'stage_change',
  'call',
  'meeting',
  'email',
  'whatsapp',
  'verification',
  'report',
  'proposal',
  'permission',
  'project',
  'system',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
export const ACTIVITY_LABELS = labels<ActivityType>({
  note: 'Note',
  stage_change: 'Stage change',
  call: 'Call',
  meeting: 'Meeting',
  email: 'Email',
  whatsapp: 'WhatsApp',
  verification: 'Verification',
  report: 'Report',
  proposal: 'Proposal',
  permission: 'Permission',
  project: 'Project',
  system: 'System',
});
/** Activity types a user may log by hand. Contact types require permission. */
export const LOGGABLE_ACTIVITIES: readonly ActivityType[] = ['note', 'call', 'meeting', 'email', 'whatsapp'];
export const CONTACT_ACTIVITIES: readonly ActivityType[] = ['call', 'meeting', 'email', 'whatsapp'];

export const PROPOSAL_STATUSES = ['draft', 'approved', 'sent', 'accepted', 'declined', 'withdrawn'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];
export const PROPOSAL_STATUS_META: Record<ProposalStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  approved: { label: 'Approved internally', tone: 'info' },
  sent: { label: 'Sent', tone: 'warning' },
  accepted: { label: 'Accepted', tone: 'success' },
  declined: { label: 'Declined', tone: 'danger' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
};

export const PROJECT_TYPES = ['website', 'ecommerce', 'booking', 'dashboard', 'mobile_app', 'ai_automation', 'custom_software'] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];
export const PROJECT_TYPE_LABELS = labels<ProjectType>({
  website: 'Website',
  ecommerce: 'Ecommerce',
  booking: 'Booking application',
  dashboard: 'Internal dashboard',
  mobile_app: 'Mobile application',
  ai_automation: 'AI automation',
  custom_software: 'Custom software',
});

export const PROJECT_STATUSES = ['planning', 'in_progress', 'on_hold', 'delivered', 'maintenance', 'cancelled'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const PROJECT_STATUS_META: Record<ProjectStatus, { label: string; tone: Tone }> = {
  planning: { label: 'Planning', tone: 'neutral' },
  in_progress: { label: 'In progress', tone: 'info' },
  on_hold: { label: 'On hold', tone: 'warning' },
  delivered: { label: 'Delivered', tone: 'success' },
  maintenance: { label: 'Maintenance', tone: 'accent' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
};

export const INVOICE_STATUSES = ['not_invoiced', 'partially_invoiced', 'invoiced', 'paid'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const INVOICE_STATUS_LABELS = labels<InvoiceStatus>({
  not_invoiced: 'Not invoiced',
  partially_invoiced: 'Partially invoiced',
  invoiced: 'Invoiced',
  paid: 'Paid',
});

export const MAINTENANCE_STATUSES = ['none', 'offered', 'active', 'ended'] as const;
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

export const ROLES = ['owner', 'admin', 'researcher', 'sales', 'developer', 'viewer'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABELS = labels<Role>({
  owner: 'Owner',
  admin: 'Administrator',
  researcher: 'Researcher',
  sales: 'Sales',
  developer: 'Developer',
  viewer: 'Viewer',
});
