// Digital audit: turns recorded verification evidence into findings. Every finding cites evidence;
// rules that lack evidence produce nothing. Verified issues (observed directly, e.g. no HTTPS) are kept
// apart from growth opportunities (hypotheses from the sector and what was not found).
// Impact statements are hypotheses, never claims about sales, customers or revenue.

import { TRACKS, trackForCategory, type TrackKey } from './categories';
import { WEBSITE_STATUS_META, type Tone } from './constants';
import type { PageFacts } from './page-signals';
import type { Business, TechnicalCheck, WebsiteVerification } from './types';
import { readEvidence } from './website-assessment';

export const AUDIT_CATEGORIES = ['website_presence', 'technical', 'mobile', 'performance', 'seo', 'content', 'conversion', 'commerce'] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];
export const AUDIT_CATEGORY_LABELS: Record<AuditCategory, string> = {
  website_presence: 'Website presence',
  technical: 'Technical',
  mobile: 'Mobile experience',
  performance: 'Performance',
  seo: 'Search basics',
  content: 'Content',
  conversion: 'Enquiries and bookings',
  commerce: 'Online commerce',
};

export const AUDIT_KINDS = ['verified_issue', 'opportunity'] as const;
export type AuditKind = (typeof AUDIT_KINDS)[number];
export const AUDIT_KIND_LABELS: Record<AuditKind, string> = { verified_issue: 'Verified issue', opportunity: 'Growth opportunity (hypothesis)' };

export const AUDIT_SEVERITIES = ['info', 'low', 'medium', 'high'] as const;
export type AuditSeverity = (typeof AUDIT_SEVERITIES)[number];
export const SEVERITY_META: Record<AuditSeverity, { label: string; tone: Tone }> = {
  info: { label: 'Info', tone: 'neutral' },
  low: { label: 'Low', tone: 'neutral' },
  medium: { label: 'Medium', tone: 'warning' },
  high: { label: 'High', tone: 'danger' },
};

export interface FindingEvidence {
  statement: string;
  source: string | null;
  observedAt: string | null;
}

export interface FindingDraft {
  findingKey: string;
  category: AuditCategory;
  kind: AuditKind;
  title: string;
  evidence: FindingEvidence[];
  severity: AuditSeverity;
  confidence: number;
  impactHypothesis: string;
  recommendation: string;
}

const BOOKING_TRACKS: TrackKey[] = ['beauty', 'hospitality', 'fitness', 'events', 'creative', 'education', 'bridal', 'professional'];
const CATALOGUE_TRACKS: TrackKey[] = ['fashion', 'furniture', 'bridal', 'auto', 'food'];
const COMMERCE_TRACKS: TrackKey[] = ['fashion', 'furniture', 'food'];

const LEGACY_CONFIDENCE = { low: 40, medium: 65, high: 85 } as const;
const day = (iso: string) => iso.slice(0, 10);

export function verificationConfidence(v: WebsiteVerification) {
  return v.confidenceScore ?? LEGACY_CONFIDENCE[v.confidence];
}

export interface AuditInput {
  business: Pick<Business, 'name' | 'category' | 'socialProfiles'>;
  /** The verification currently in force (see effectiveVerification). */
  verification: WebsiteVerification | null;
  now: Date;
}

export function auditFindings({ business, verification: v, now }: AuditInput): FindingDraft[] {
  if (!v) return [];
  const out: FindingDraft[] = [];
  const track = trackForCategory(business.category);
  const guidance = TRACKS[track];
  const evidence = readEvidence(v.evidence);
  const conf = verificationConfidence(v);
  const cite: FindingEvidence = {
    statement: `Website verification on ${day(v.checkedAt)}: ${WEBSITE_STATUS_META[v.status].label} (${evidence ? `${evidence.confidenceScore}/100` : `${v.confidence} confidence`}; ${v.methods.length} method${v.methods.length === 1 ? '' : 's'}).`,
    source: v.sourceUrl,
    observedAt: v.checkedAt,
  };
  const sectorNote: FindingEvidence = { statement: `Recorded category: ${business.category}.`, source: null, observedAt: null };

  // ── Presence ──
  if (v.status === 'none_found') {
    const social = [...new Set([...business.socialProfiles.map((p) => p.platform), ...(evidence?.socialFound ?? [])])];
    out.push({
      findingKey: 'no_official_website',
      category: 'website_presence',
      kind: 'verified_issue',
      title: 'No official website discovered',
      evidence: [cite, { statement: 'This is the result of documented checks, not proof that no website exists.', source: null, observedAt: null }],
      severity: 'high',
      confidence: conf,
      impactHypothesis: 'People who look the business up online may not find an official place for its offer, location and enquiry options. Hypothesis — not measured.',
      recommendation: guidance.primary[0] ?? 'A mobile-first official website with clear enquiry options.',
    });
    if (social.length) {
      out.push({
        findingKey: 'social_only_presence',
        category: 'website_presence',
        kind: 'verified_issue',
        title: 'Social-only presence',
        evidence: [cite, { statement: `Present on ${social.join(', ')}${business.socialProfiles.length ? ' (recorded on the profile)' : ''}.`, source: business.socialProfiles[0]?.url ?? null, observedAt: v.checkedAt }],
        severity: 'medium',
        confidence: Math.min(conf, 90),
        impactHypothesis: 'Enquiries depend on platforms the business does not control, with no owned page for catalogue, prices or bookings. Hypothesis.',
        recommendation: 'An owned website that links to and from the existing social profiles.',
      });
    }
  }
  if (v.status === 'unavailable' || v.status === 'unhealthy') {
    out.push({
      findingKey: 'website_not_working',
      category: 'technical',
      kind: 'verified_issue',
      title: v.status === 'unavailable' ? 'Website not reachable' : 'Website returns errors',
      evidence: [cite, ...(v.technical ? [technicalCite(v.technical, v.technical.error ?? `HTTP ${v.technical.status}`)] : [])],
      severity: 'high',
      confidence: conf,
      impactHypothesis: 'Visitors following links to the site reach an error instead of the business. Hypothesis.',
      recommendation: evidence?.failure && !evidence.failure.persistent ? 'Re-check first (this may be temporary), then restore hosting or rebuild the site.' : 'Restore the domain and hosting, or rebuild the site.',
    });
  }

  // ── The working site ──
  const site = (v.status === 'verified_official' || v.status === 'potential_official') && v.technical?.ok ? v.technical : null;
  const facts: PageFacts | null = site ? (evidence?.candidates.find((c) => c.check?.url === site.url)?.facts ?? null) : null;
  if (site) {
    if (!site.https) {
      out.push({
        findingKey: 'no_https',
        category: 'technical',
        kind: 'verified_issue',
        title: 'Website not served over HTTPS',
        evidence: [technicalCite(site, `final address ${site.finalUrl ?? site.url} uses http://`)],
        severity: 'medium',
        confidence: 90,
        impactHypothesis: 'Browsers label the site “Not secure”, which may discourage enquiries. Hypothesis.',
        recommendation: 'Enable HTTPS with a free certificate and redirect http:// to https://.',
      });
    }
    if (site.hasViewport === false) {
      out.push({
        findingKey: 'no_mobile_viewport',
        category: 'mobile',
        kind: 'verified_issue',
        title: 'No mobile viewport configuration',
        evidence: [technicalCite(site, 'the homepage has no viewport meta tag, so phones show a zoomed-out desktop layout')],
        severity: 'medium',
        confidence: 85,
        impactHypothesis: 'Most visitors in Ghana browse on phones; a desktop-only layout is harder to use. Hypothesis.',
        recommendation: 'A responsive, mobile-first layout.',
      });
    }
    if (site.responseMs != null && site.responseMs > 3000) {
      out.push({
        findingKey: 'slow_response',
        category: 'performance',
        kind: 'verified_issue',
        title: 'Slow homepage response',
        evidence: [technicalCite(site, `the server took ${site.responseMs} ms to respond (one measurement; full page load not measured)`)],
        severity: site.responseMs > 6000 ? 'medium' : 'low',
        confidence: 50,
        impactHypothesis: 'Slow responses on mobile data can make visitors leave before the page loads. Hypothesis.',
        recommendation: 'Measure again, then review hosting and page weight.',
      });
    }
    if (facts) {
      const missing = [!facts.title ? 'page title' : null, !facts.description ? 'meta description' : null, !facts.h1.length ? 'main heading' : null].filter(Boolean);
      if (missing.length) {
        out.push({
          findingKey: 'missing_seo_basics',
          category: 'seo',
          kind: 'verified_issue',
          title: 'Missing basic search metadata',
          evidence: [technicalCite(site, `the homepage has no ${missing.join(', ')}`)],
          severity: missing.length >= 2 ? 'medium' : 'low',
          confidence: 85,
          impactHypothesis: 'Search engines and link previews have less to show about the business. Hypothesis — rankings were not measured.',
          recommendation: 'Add a descriptive title, meta description and main heading to each page.',
        });
      }
      if (facts.insecureFormAction) {
        out.push({
          findingKey: 'insecure_form',
          category: 'technical',
          kind: 'verified_issue',
          title: 'Form submits over an insecure connection',
          evidence: [technicalCite(site, 'a form on the homepage posts to an http:// address')],
          severity: 'high',
          confidence: 85,
          impactHypothesis: 'Details typed into the form can be read in transit. Hypothesis about risk, not an observed incident.',
          recommendation: 'Post forms over HTTPS only.',
        });
      }
      if (!facts.formCount && !facts.hasTelLink && !facts.hasMailtoLink && !facts.hasWhatsAppLink) {
        out.push({
          findingKey: 'no_enquiry_route',
          category: 'conversion',
          kind: 'verified_issue',
          title: 'No enquiry route on the homepage',
          evidence: [technicalCite(site, 'no contact form, phone, email or WhatsApp link on the homepage (other pages were not checked)')],
          severity: 'medium',
          confidence: 60,
          impactHypothesis: 'Interested visitors may not see how to get in touch. Hypothesis.',
          recommendation: 'Clear enquiry options (form, call and WhatsApp buttons) on every page.',
        });
      }
      if (facts.copyrightYear && facts.copyrightYear <= now.getUTCFullYear() - 3) {
        out.push({
          findingKey: 'stale_information',
          category: 'content',
          kind: 'opportunity',
          title: 'Published information may be outdated',
          evidence: [technicalCite(site, `the copyright notice was last updated in ${facts.copyrightYear}`)],
          severity: 'low',
          confidence: 45,
          impactHypothesis: 'An old notice can signal that prices, stock or opening hours are out of date. Hypothesis — the content itself was not reviewed.',
          recommendation: 'Review and refresh the site content; consider a simple way for staff to update it.',
        });
      }
    }
  }

  // ── Sector opportunities (only from what was checked) ──
  const noSite = v.status === 'none_found' || v.status === 'unavailable';
  const absent = (flag: keyof Pick<PageFacts, 'booking' | 'catalogue' | 'commerce'>) => (noSite ? true : facts ? !facts[flag] : false);
  const where = (thing: string): FindingEvidence =>
    noSite ? cite : technicalCite(site!, `no ${thing} found on the homepage (other pages were not checked)`);
  if (BOOKING_TRACKS.includes(track) && absent('booking')) {
    out.push({
      findingKey: 'no_online_booking',
      category: 'conversion',
      kind: 'opportunity',
      title: 'No online booking found',
      evidence: [where('booking or appointment link'), sectorNote],
      severity: 'medium',
      confidence: noSite ? 40 : 45,
      impactHypothesis: `${guidance.customerJourney} Structured booking could reduce back-and-forth. Hypothesis.`,
      recommendation: 'An appointment or booking request flow.',
    });
  }
  if (CATALOGUE_TRACKS.includes(track) && absent('catalogue')) {
    out.push({
      findingKey: 'no_product_catalogue',
      category: 'content',
      kind: 'opportunity',
      title: track === 'food' ? 'No online menu found' : 'No online product catalogue found',
      evidence: [where(track === 'food' ? 'menu' : 'product or collection pages'), sectorNote],
      severity: 'medium',
      confidence: noSite ? 40 : 45,
      impactHypothesis: `${guidance.customerJourney} Hypothesis.`,
      recommendation: guidance.opportunities[0]?.description ?? 'A browsable catalogue.',
    });
  }
  if (!noSite && COMMERCE_TRACKS.includes(track) && absent('commerce')) {
    out.push({
      findingKey: 'no_online_commerce',
      category: 'commerce',
      kind: 'opportunity',
      title: 'No online ordering found',
      evidence: [where('cart, checkout or payment option'), sectorNote],
      severity: 'low',
      confidence: 40,
      impactHypothesis: 'Where stock is managed consistently, online ordering can extend sales beyond opening hours. Hypothesis.',
      recommendation: 'Online ordering with a local payment provider, after merchant onboarding.',
    });
  }
  return out;
}

function technicalCite(check: TechnicalCheck, detail: string): FindingEvidence {
  return { statement: `Automated check of ${check.url} on ${day(check.checkedAt)}: ${detail}.`, source: check.finalUrl ?? check.url, observedAt: check.checkedAt };
}
