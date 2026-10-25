// Editorial plans: the words and media roles a composition turns into pages.
//
// A plan is deliberately separate from layout. The brief and approved concept decide what a page
// must say and which approved visual role it needs; the composition module decides whether that
// becomes an editorial spread, a cinematic scene, an offset masthead or a catalogue row. This keeps
// the same narrative open to genuinely different compositions and prevents every concept producing
// the same section skeleton.

import type { SectorProfile } from './creative-direction';
import type { BlueprintAction, BlueprintSection, SiteTone } from './website-blueprint';

/** A named visual slot resolved against the approved asset set. */
export type AssetRole =
  | 'hero'
  | 'portrait'
  | 'detail'
  | 'scene'
  | 'context'
  | 'drawing'
  | 'drawing-alt'
  | 'texture'
  | 'arrival'
  | 'garden'
  | 'threshold'
  | 'table'
  | 'room-alt'
  | 'house'
  | 'arrival-mobile';

export interface EditorialPlate {
  assetRole: AssetRole;
  caption?: string;
  credit?: string;
  index?: string;
  emphasis?: 'portrait' | 'landscape' | 'square' | 'wide' | 'full';
  focal?: 'centre' | 'top' | 'bottom' | 'left' | 'right';
  placeholder?: boolean;
  title?: string;
  body?: string;
}

interface SectionBase {
  label: string;
  tone?: SiteTone;
  note?: string;
}

export interface EditorialHero extends SectionBase {
  kind: 'hero';
  variant?: Extract<BlueprintSection, { kind: 'hero' }>['variant'];
  eyebrow: string;
  lines: string[];
  lead: string;
  meta: { label: string; value: string }[];
  assetRole?: AssetRole;
  mobileAssetRole?: AssetRole;
  primary?: BlueprintAction;
  secondary?: BlueprintAction;
}

export interface EditorialStatement extends SectionBase {
  kind: 'statement';
  variant?: Extract<BlueprintSection, { kind: 'statement' }>['variant'];
  title?: string;
  body: string[];
  aside?: string;
  assetRole?: AssetRole;
}

export interface EditorialSequence extends SectionBase {
  kind: 'sequence';
  variant?: Extract<BlueprintSection, { kind: 'sequence' }>['variant'];
  title?: string;
  items: EditorialPlate[];
}

export interface EditorialIndex extends SectionBase {
  kind: 'index';
  title: string;
  description?: string;
  countLabel?: string;
  entries: {
    number: string;
    title: string;
    meta: string[];
    summary?: string;
    assetRole?: AssetRole;
    tag?: string;
    pageSlug?: string;
  }[];
}

export interface EditorialChapter extends SectionBase {
  kind: 'chapter';
  variant?: Extract<BlueprintSection, { kind: 'chapter' }>['variant'];
  number?: string;
  title: string;
  body: string[];
  assetRole?: AssetRole;
  details?: { label: string; value: string }[];
}

export interface EditorialProcess extends SectionBase {
  kind: 'process';
  title: string;
  steps: { number: string; title: string; body: string }[];
}

export interface EditorialGallery extends SectionBase {
  kind: 'gallery';
  variant?: Extract<BlueprintSection, { kind: 'gallery' }>['variant'];
  title?: string;
  items: EditorialPlate[];
}

export interface EditorialDetails extends SectionBase {
  kind: 'details';
  title: string;
  body?: string;
  items: { label: string; value: string; note?: string; placeholder?: boolean }[];
  action?: BlueprintAction;
}

export interface EditorialCta extends SectionBase {
  kind: 'cta';
  variant?: Extract<BlueprintSection, { kind: 'cta' }>['variant'];
  assetRole?: AssetRole;
  eyebrow: string;
  title: string;
  body: string;
  primary: BlueprintAction;
  secondary?: BlueprintAction;
}

export type EditorialSection =
  | EditorialHero
  | EditorialStatement
  | EditorialSequence
  | EditorialIndex
  | EditorialChapter
  | EditorialProcess
  | EditorialGallery
  | EditorialDetails
  | EditorialCta;

export interface EditorialPage {
  slug: string;
  label: string;
  title: string;
  description: string;
  tone?: SiteTone;
  inNavigation?: boolean;
  sections: EditorialSection[];
}

export interface WebsiteEditorial {
  siteName: string;
  monogram: string;
  descriptor: string;
  action: BlueprintAction | null;
  pages: EditorialPage[];
  designNotes: string[];
}

const pageAction = (label: string, target: string): BlueprintAction => ({ kind: 'page', label, target });
const prototypeAction = (label: string): BlueprintAction => ({
  kind: 'prototype',
  label,
  target: 'enquiry',
  note: 'Prototype only: this opens a notice. Nothing is sent and no customer details are collected.',
});

const clean = (value: string | null | undefined, fallback = '') => (value ?? '').replace(/\s+/g, ' ').trim() || fallback;
const firstSummary = (summaries: string[]) => summaries.find((entry) => clean(entry).length > 24) ?? '';

/**
 * The default editorial plan for any approved direction. It uses only brief content and the
 * concept's own story, and turns unknown commercial facts into visible questions rather than
 * plausible-sounding copy. The three showcase plans feed the same builder with richer material.
 */
export function editorialFromDirection(input: {
  profile: SectorProfile;
  businessName: string;
  city: string;
  siteName: string;
  monogram: string;
  descriptor: string;
  concept: {
    idea: string;
    narrative: string;
    story: { premise: string; arc: string[]; chapters: { name: string; intent: string }[] };
    conversion: { primaryCta: string; path: string[] };
  };
  brief: {
    sections: Record<string, { summary: string; assertions: { text: string }[] }>;
    missingInformation: { question: string }[];
  };
}): WebsiteEditorial {
  const { concept, businessName, city, profile } = input;
  const identity = firstSummary(input.brief.sections.identity?.assertions.map((assertion) => assertion.text) ?? []);
  const trade = clean(identity, `${businessName} is a ${profile.replace(/_/g, ' ')} business in ${city}.`);
  const chapters = concept.story.chapters.length >= 3
    ? concept.story.chapters
    : [
        { name: 'The claim', intent: 'Say what the business does, for whom and where.' },
        { name: 'The evidence', intent: 'Show the work and the decisions behind it.' },
        { name: 'The invitation', intent: 'Make the first step specific.' },
      ];
  const primary = prototypeAction(concept.conversion.primaryCta);
  const workLabel = profile === 'hospitality' ? 'Rooms' : profile === 'architecture' ? 'Work' : profile === 'fashion' ? 'Collections' : 'Services';
  const workSlug = workLabel === 'Rooms' ? 'rooms' : workLabel === 'Work' ? 'work' : workLabel === 'Collections' ? 'collections' : 'services';
  const missing = input.brief.missingInformation.slice(0, 4);
  const question = missing[0]?.question ?? 'Commercial details, availability and terms must be confirmed by the business.';
  const story = concept.story.premise.split(/(?<=[.!?])\s+/).slice(0, 2).map((line) => line.replace(/[.!?]$/, ''));
  return {
    siteName: input.siteName,
    monogram: input.monogram,
    descriptor: input.descriptor,
    action: primary,
    pages: [
      {
        slug: 'home',
        label: 'Home',
        title: businessName,
        description: trade.slice(0, 240),
        sections: [
          {
            kind: 'hero',
            label: 'Opening',
            eyebrow: `${businessName} — ${city}`,
            lines: story.length ? story : [businessName],
            lead: concept.story.premise,
            meta: [
              { label: 'Place', value: city },
              { label: 'Focus', value: input.descriptor },
            ],
            assetRole: 'hero',
            primary: pageAction(primary.label, workSlug),
            secondary: { kind: 'anchor', label: 'Read the argument', target: 'argument' },
            note: 'Opening copy is a creative proposal for review, not a claim about the business.',
          },
          {
            kind: 'statement',
            label: 'Argument',
            title: concept.story.premise,
            body: [concept.narrative, trade],
            aside: concept.idea,
            tone: 'surface',
          },
          {
            kind: 'sequence',
            label: 'Evidence',
            title: 'Look closely.',
            items: [
              { assetRole: 'hero', caption: 'Concept image — replace with the business’s own approved photography.' },
              { assetRole: 'portrait', caption: 'A second, quieter frame; the crop is part of the argument.' },
              { assetRole: 'detail', caption: 'Material, tool or place. Caption approved by the business before publication.' },
            ],
            note: 'Only approved, prototype-cleared files are rendered. Missing photography remains a visible commission.',
          },
          {
            kind: 'index',
            label: 'Work',
            title: `${workLabel} at a glance`,
            description: `A compact index of what ${businessName} offers. Entries are concept placeholders until the business confirms its current range.`,
            countLabel: '03 entries',
            entries: [
              { number: '01', title: chapters[0]?.name ?? 'First', meta: ['To be confirmed', city], summary: chapters[0]?.intent ?? 'Replace with the business’s own description.', assetRole: 'portrait' },
              { number: '02', title: chapters[1]?.name ?? 'Second', meta: ['To be confirmed', city], summary: chapters[1]?.intent ?? 'Replace with the business’s own description.', assetRole: 'detail' },
              { number: '03', title: chapters[2]?.name ?? 'Third', meta: ['To be confirmed', city], summary: chapters[2]?.intent ?? 'Replace with the business’s own description.', assetRole: 'scene' },
            ],
            note: 'Concept entries — not a statement of current stock, services or availability.',
          },
          {
            kind: 'process',
            label: 'Method',
            title: 'How the work begins',
            steps: [
              { number: '01', title: 'A specific conversation', body: 'Say what you are making, buying or planning, and what the decision depends on.' },
              { number: '02', title: 'A considered proposal', body: 'The business confirms scope, timing and cost in writing. This prototype does not invent them.' },
              { number: '03', title: 'The work, reviewed', body: 'Decisions are recorded, so the final piece can be judged against the brief rather than memory.' },
            ],
            note: 'Process copy is a creative proposal; the business must confirm each step, fee and lead time.',
          },
          {
            kind: 'cta',
            label: 'Invitation',
            tone: 'ink',
            eyebrow: 'One next step',
            title: primary.label,
            body: question,
            primary,
            secondary: pageAction('See the contact page', 'contact'),
            note: 'No enquiry is sent from this prototype.',
          },
        ],
      },
      {
        slug: workSlug,
        label: workLabel,
        title: workLabel,
        description: `A considered index of ${workLabel.toLowerCase()} for ${businessName}.`,
        sections: [
          {
            kind: 'hero',
            label: 'Page opening',
            eyebrow: `${businessName} / ${workLabel}`,
            lines: [workLabel],
            lead: 'A closer look at the work. The entries below are concept placeholders until the business supplies its own record.',
            meta: [{ label: 'Place', value: city }],
            primary: pageAction('Start a conversation', 'contact'),
          },
          {
            kind: 'gallery',
            label: 'Plates',
            title: 'The work, shown at close range.',
            items: [
              { assetRole: 'hero', emphasis: 'wide', index: '01', caption: 'Concept image — not a record of a completed commission.' },
              { assetRole: 'detail', emphasis: 'portrait', index: '02', caption: 'Material and finish reference.' },
              { assetRole: 'portrait', emphasis: 'square', index: '03', caption: 'A second view, deliberately unequal.' },
            ],
            note: 'Every image is a licensed or client-approved file; no third-party page is scraped.',
          },
          {
            kind: 'index',
            label: 'Register',
            title: 'The register',
            description: 'Facts, not atmosphere: what each piece is, what it is made of and what remains to be confirmed.',
            entries: chapters.map((chapter, index) => ({
              number: String(index + 1).padStart(2, '0'),
              title: chapter.name,
              meta: ['Concept placeholder', city],
              summary: chapter.intent,
              assetRole: (['detail', 'portrait', 'scene'] as AssetRole[])[index % 3],
              tag: 'To confirm',
            })),
            note: 'The business will replace these entries with its approved work before publication.',
          },
          {
            kind: 'cta',
            label: 'Invitation',
            eyebrow: 'Begin',
            title: primary.label,
            body: 'Tell the business what you are deciding. A specific message is easier to answer than a general enquiry.',
            primary,
            secondary: pageAction('Read how it works', 'about'),
          },
        ],
      },
      {
        slug: 'about',
        label: 'About',
        title: `About ${businessName}`,
        description: `The people, place and argument behind ${businessName}.`,
        sections: [
          {
            kind: 'hero',
            label: 'Page opening',
            eyebrow: `${businessName} / About`,
            lines: ['A practice,', 'not a promise.'],
            lead: trade,
            meta: [{ label: 'Place', value: city }],
            assetRole: 'scene',
          },
          {
            kind: 'chapter',
            label: 'Position',
            number: '01',
            title: chapters[0]?.name ?? 'The claim',
            body: [concept.idea, concept.story.premise],
            assetRole: 'portrait',
            details: [
              { label: 'Place', value: city },
              { label: 'Focus', value: input.descriptor },
            ],
            note: 'A creative position, not a claim about the business’s history or credentials.',
          },
          {
            kind: 'process',
            label: 'Method',
            title: 'How decisions are made',
            steps: [
              { number: '01', title: chapters[0]?.name ?? 'Begin', body: chapters[0]?.intent ?? 'Start with the specific question.' },
              { number: '02', title: chapters[1]?.name ?? 'Test', body: chapters[1]?.intent ?? 'Test the idea against material and constraint.' },
              { number: '03', title: chapters[2]?.name ?? 'Resolve', body: chapters[2]?.intent ?? 'Resolve the work and review it plainly.' },
            ],
            note: 'Confirm the actual method with the business.',
          },
          {
            kind: 'cta',
            label: 'Invitation',
            eyebrow: 'The next step',
            title: primary.label,
            body: question,
            primary,
            secondary: pageAction('Contact', 'contact'),
          },
        ],
      },
      {
        slug: 'contact',
        label: 'Contact',
        title: `Contact ${businessName}`,
        description: `How to begin a conversation with ${businessName}.`,
        sections: [
          {
            kind: 'hero',
            label: 'Page opening',
            eyebrow: `${businessName} / Contact`,
            lines: ['One clear', 'next step.'],
            lead: 'The prototype does not collect enquiries, send messages or expose a private address. The final site will use the route the business confirms.',
            meta: [{ label: 'Place', value: city }],
          },
          {
            kind: 'details',
            label: 'Practical details',
            title: 'What the business publishes',
            body: 'These entries distinguish what is known from what still needs a decision.',
            items: [
              { label: 'Place', value: city },
              { label: 'Primary route', value: 'To be confirmed', placeholder: true, note: 'The direction proposes one route; the business must approve it.' },
              { label: 'Hours', value: 'To be confirmed', placeholder: true },
              { label: 'Response time', value: 'Not published', placeholder: true },
            ],
            action: primary,
            note: 'Prototype only. No details are collected.',
          },
          ...missing.slice(1).map<EditorialDetails>((item) => ({
            kind: 'details',
            label: 'Open question',
            title: 'Still to confirm',
            body: item.question,
            items: [{ label: 'Question', value: item.question, placeholder: true }],
          })),
          {
            kind: 'cta',
            label: 'Invitation',
            eyebrow: 'Prototype',
            title: 'See the enquiry notice',
            body: 'This demonstrates the final interaction without sending anything or collecting personal information.',
            primary,
            secondary: pageAction('Return home', 'home'),
            note: 'No form, payment or tracking is present.',
          },
        ],
      },
    ],
    designNotes: [
      `Generated content plan for the ${profile.replace(/_/g, ' ')} profile.`,
      'All commercial details remain visibly unconfirmed until the business supplies them.',
      'The approved concept determines composition, type, colour and motion; this plan only supplies words and visual roles.',
    ],
  };
}
