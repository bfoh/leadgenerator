// Phase 4 contact agents. Contact Research records the contact channels a business publishes on
// its own verified website (homepage and at most one contact page it links to, robots.txt first),
// plus the details already on the profile, each with its source. Contact Validation checks them
// (syntax, domain, MX, E.164, duplicates) and classifies them. Neither agent records consent,
// guesses addresses, reads social platforms, checks numbers against WhatsApp or probes mailboxes;
// a contact detail they find is never permission to message it.

import { z } from 'zod';
import * as contacts from '@/lib/data/contact-services';
import type { ResearchedContact } from '@/lib/data/contact-services';
import { CONTACTS_MIGRATION_REQUIRED } from '@/lib/data/store';
import type { ExtractedContacts } from '@/lib/domain/contact-extraction';
import { CLASSIFICATION_LABELS, CONTACT_RESEARCH_VERSION, CONTACT_VALIDATION_VERSION, classifyContact, normalizeContact, validateContactPoint, type ContactClassification, type MxResult } from '@/lib/domain/contacts';
import { errorMessage } from '@/lib/utils';
import { canResetFrom, readyForReport, reportFollowUp } from './research';
import { AgentError, type AgentDefinition, type AgentResult } from './types';

/** Website contact research is not repeated within this many days unless a person asks. */
export const CONTACT_RESEARCH_INTERVAL_DAYS = 30;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function detailsOf(page: ExtractedContacts): ResearchedContact[] {
  return [
    ...page.emails.map((d) => ({ type: 'email' as const, value: d.normalized, pageUrl: page.pageUrl, via: d.via })),
    ...page.phones.map((d) => ({ type: 'phone' as const, value: d.normalized, pageUrl: page.pageUrl, via: d.via })),
    ...page.whatsapp.map((d) => ({ type: 'whatsapp' as const, value: d.normalized, pageUrl: page.pageUrl, via: d.via })),
  ];
}

// ── Contact Research ─────────────────────────────────────────────────────────

const researchInput = z.object({ pipeline: z.boolean().default(false), force: z.boolean().default(false) }).strict();

export const contactResearchAgent: AgentDefinition<z.infer<typeof researchInput>> = {
  key: 'contact_research',
  name: 'Contact Research',
  version: CONTACT_RESEARCH_VERSION,
  description: 'Records the contact channels a business publishes on its own verified website, and the details already on the profile, each with its source.',
  phase: 4,
  minimumMode: 'research_only',
  may: 'Add contact points with their source page, from the verified official website only (homepage and one contact page, robots.txt honoured).',
  never: 'Guess email addresses, use Google Places or search-result contact fields, read social platforms, check numbers against WhatsApp, collect private details or record consent.',
  providers: [],
  needsBusiness: true,
  stepState: 'contact_research',
  timeoutMs: 60_000,
  input: researchInput,
  async run({ input, business, svc: ctx, tools, signal, now, jobId }) {
    const b = business!;
    if (!(await ctx.store.contactSchemaAvailable())) throw new AgentError(CONTACTS_MIGRATION_REQUIRED, 'permanent');
    const imported = await contacts.importProfileContacts(ctx, b, { agentVersion: CONTACT_RESEARCH_VERSION, jobId });

    const notes: string[] = [];
    const pagesRead: string[] = [];
    let found: ResearchedContact[] = [];
    let hasForm = false;
    let contactPage: string | null = null;
    const existing = await ctx.store.listContactPoints(b.id);
    const lastRead = existing.filter((p) => p.sourceType === 'business_website' && p.lastSeenAt).sort((x, y) => y.lastSeenAt!.localeCompare(x.lastSeenAt!))[0]?.lastSeenAt ?? null;
    const recent = lastRead && now.getTime() - new Date(lastRead).getTime() < CONTACT_RESEARCH_INTERVAL_DAYS * 86_400_000;

    if (b.websiteStatus !== 'verified_official' || !b.officialWebsite) {
      notes.push('No verified official website, so no website was read for contact details.');
    } else if (!tools.contacts.available) {
      notes.push('Website contact research needs the server tools (sign in, or run the app with server tools).');
    } else if (recent && !input.force) {
      notes.push(`The website was read for contact details on ${lastRead!.slice(0, 10)}; it is read again after ${CONTACT_RESEARCH_INTERVAL_DAYS} days.`);
    } else {
      const home = await tools.readContactPage(b.officialWebsite, signal);
      if (home.robots === 'disallowed') notes.push('The website’s robots.txt does not allow automated reading; nothing was read.');
      else if (!home.contacts) notes.push(`The homepage could not be read (${home.check?.error ?? 'no content'}).`);
      else {
        pagesRead.push(home.contacts.pageUrl);
        found = detailsOf(home.contacts);
        hasForm = home.contacts.hasForm;
        contactPage = home.contacts.contactPages[0] ?? null;
        if (contactPage) {
          try {
            const page = await tools.readContactPage(contactPage, signal);
            if (page.contacts) {
              pagesRead.push(page.contacts.pageUrl);
              found.push(...detailsOf(page.contacts));
              if (page.contacts.hasForm) {
                hasForm = true;
                contactPage = page.contacts.pageUrl;
              }
            } else notes.push(page.robots === 'disallowed' ? 'robots.txt does not allow reading the contact page.' : `The contact page could not be read (${page.check?.error ?? 'no content'}).`);
          } catch (e) {
            if (signal.aborted) throw e;
            notes.push(`The contact page could not be read (${errorMessage(e)}).`);
          }
        }
        // The official contact page and its enquiry form are business-level channels too.
        if (contactPage) found.push({ type: hasForm ? 'contact_form' : 'contact_page', value: contactPage, pageUrl: contactPage, via: 'contact_page_link' });
        else if (hasForm) found.push({ type: 'contact_form', value: home.contacts.pageUrl, pageUrl: home.contacts.pageUrl, via: 'page_form' });
      }
    }

    const saved = pagesRead.length ? await contacts.saveResearchedContacts(ctx, b, found, { agentVersion: CONTACT_RESEARCH_VERSION, jobId, pagesRead }) : { created: [], refreshed: 0, outdated: 0 };
    const added = imported.length + saved.created.length;
    const parts = [
      pagesRead.length ? `Read ${plural(pagesRead.length, 'page')} of the official website` : null,
      `${plural(added, 'new contact detail')} recorded with ${added === 1 ? 'its' : 'their'} source`,
      saved.refreshed ? `${saved.refreshed} confirmed again` : null,
      saved.outdated ? `${saved.outdated} no longer published (marked outdated)` : null,
    ].filter(Boolean);
    return {
      summary: `${parts.join('; ')}. Permission is still required before any outreach.${notes.length ? ` ${notes.join(' ')}` : ''}`,
      decision: added || saved.refreshed ? 'Contact details recorded for validation' : 'No new contact details',
      output: { pagesRead, created: saved.created.length, imported: imported.length, refreshed: saved.refreshed, outdated: saved.outdated, notes },
      transition: canResetFrom(b) ? { to: 'contact_research', reason: 'Contact details recorded with their source; validation comes next' } : null,
      followUps: [{ agent: 'contact_validation', businessId: b.id, payload: { pipeline: input.pipeline } }],
    };
  },
};

// ── Contact Validation ───────────────────────────────────────────────────────

const validationInput = z.object({ pipeline: z.boolean().default(false) }).strict();

export const contactValidationAgent: AgentDefinition<z.infer<typeof validationInput>> = {
  key: 'contact_validation',
  name: 'Contact Validation',
  version: CONTACT_VALIDATION_VERSION,
  description: 'Checks email syntax, domains and mail servers (MX), normalises phone numbers to E.164, flags duplicates and classifies each contact detail.',
  phase: 4,
  minimumMode: 'research_only',
  may: 'Record validation results and classifications, and fill empty profile phone or email fields from verified business channels.',
  never: 'Probe mailboxes, send test messages, check numbers against WhatsApp, or treat a valid detail as permission to contact it.',
  providers: [],
  needsBusiness: true,
  stepState: 'contact_research',
  timeoutMs: 45_000,
  input: validationInput,
  async run({ input, business, svc: ctx, tools, signal, now }) {
    const b = business!;
    if (!(await ctx.store.contactSchemaAvailable())) throw new AgentError(CONTACTS_MIGRATION_REQUIRED, 'permanent');
    const [points, all] = await Promise.all([ctx.store.listContactPoints(b.id), ctx.store.listContactPoints()]);

    const domains = [...new Set(points.flatMap((p) => (p.type === 'email' ? [p.normalizedValue.split('@')[1]] : [])))].slice(0, 10);
    let mx: Map<string, MxResult> | null = null;
    if (domains.length && tools.contacts.available) {
      mx = new Map((await tools.lookupMx(domains, signal)).map((r) => [r.domain, r]));
    }
    const results = points.map((point) => {
      const validation = validateContactPoint(point, { mx, others: all, now });
      const classification = classifyContact(point, validation, { officialWebsite: b.officialWebsite });
      const n = normalizeContact(point.type, point.value);
      return { point, validation, classification, phoneKind: n.ok ? (n.phoneKind ?? null) : null };
    });
    const { profile } = await contacts.saveValidations(ctx, b, results);

    const counts = results.reduce<Partial<Record<ContactClassification, number>>>((acc, r) => ({ ...acc, [r.classification]: (acc[r.classification] ?? 0) + 1 }), {});
    const summary = points.length
      ? `Checked ${plural(points.length, 'contact detail')}: ${Object.entries(counts)
          .map(([k, n]) => `${n} ${CLASSIFICATION_LABELS[k as ContactClassification].toLowerCase()}`)
          .join(', ')}.${mx ? '' : domains.length ? ' Mail servers were not looked up (server tools unavailable).' : ''} Outreach still needs recorded consent.`
      : 'No contact details are recorded for this prospect yet.';

    let followUps: NonNullable<AgentResult['followUps']> = [];
    const latest = (await ctx.store.getBusiness(b.id)) ?? b;
    if (input.pipeline && readyForReport(latest)) followUps = await reportFollowUp(ctx, latest);
    return {
      summary,
      decision: points.length ? `${counts.verified_business_channel ?? 0} verified business channel${counts.verified_business_channel === 1 ? '' : 's'}` : 'Nothing to validate',
      output: { checked: points.length, classifications: counts, mxDomains: mx ? domains.length : 0, profileUpdated: Boolean(profile) },
      transition: canResetFrom(latest) ? { to: 'qualification', reason: points.length ? 'Contact details validated' : 'No contact details to validate' } : null,
      followUps,
    };
  },
};
