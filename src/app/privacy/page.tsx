import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Privacy and data protection' };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-muted">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main id="main" className="mx-auto max-w-2xl px-4 py-12 sm:py-16">
      <Link href="/" className="text-xs text-subtle hover:text-foreground">
        ← Digital Opportunity Finder
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Privacy and data protection</h1>
      <p className="mt-2 text-sm text-subtle">
        How this workspace handles information about businesses and the people who run them, with reference to Ghana’s Data Protection Act, 2012 (Act 843). This is an operating notice for the agency’s team; have it reviewed by a qualified adviser before relying on it as a legal policy.
      </p>

      <div className="mt-8 space-y-8">
        <Section title="What is recorded">
          <p>Business research: names, categories, locations, public website and social profile links, website verification evidence, opportunity scores and the team’s notes.</p>
          <p>Contact details, where the team records them: a contact phone number or email address, where it was obtained, and whether — and on what basis — the business agreed to be contacted.</p>
          <p>Sales records: activities, meetings, proposals, projects and an audit trail of changes. Team members’ email addresses and roles.</p>
        </Section>

        <Section title="Why, and on what basis">
          <p>To identify businesses that could benefit from the agency’s services, prepare accurate assessments and proposals, and deliver agreed work.</p>
          <p>
            Contact is permission-aware: outreach stages, contact logging and sending proposals are blocked until the team records that the business agreed to hear from the agency, contacted it first, or is an existing client — with the evidence. A publicly listed number is not treated as consent to direct marketing, and bulk messaging is not supported.
          </p>
        </Section>

        <Section title="Opting out">
          <p>Any business can ask not to be contacted. The team records the opt-out immediately; it blocks every outreach stage and contact activity for that business. Ask the agency directly to have your business’s record corrected or deleted.</p>
        </Section>

        <Section title="Third-party sources">
          <p>
            Discovery uses the official Google Places API. Google results are displayed for research and are not copied into the CRM; only the Google Place ID is kept when a researcher tracks a business, and every saved fact must come from an independent source such as the business’s own website or social profile.
          </p>
          <p>
            Website checks make a single request to a business’s homepage when a researcher asks for one; there is no crawling. Optional web search and AI report generation send limited information to the configured providers (Brave Search, Anthropic). AI reports receive the business’s recorded profile, verification evidence and researcher notes — not phone numbers or email addresses — so personal information should not be written into notes.
          </p>
        </Section>

        <Section title="Security and access">
          <p>
            In cloud mode records are stored in Supabase with row-level security: each organization sees only its own data, and roles limit what each team member can change. API keys stay on the server. In demo mode records stay in the browser that created them.
          </p>
          <p>Exports are limited to owners, administrators and sales/research roles, are logged, and include contact details only when explicitly selected.</p>
        </Section>

        <Section title="Retention">
          <p>Records are kept while they serve the purposes above. Prospects that are lost or archived should be reviewed periodically and deleted when no longer needed; deleting a prospect deletes its verifications, activity, tasks, reports and proposals. A prospect with delivery projects cannot be deleted until those projects are dealt with.</p>
        </Section>

        <Section title="Your rights">
          <p>
            Under Act 843 people can ask what information is held about them, have it corrected or deleted, and object to its use for direct marketing. Data controllers in Ghana are also expected to register with the Data Protection Commission. Contact the agency operating this workspace to make a request.
          </p>
        </Section>
      </div>
    </main>
  );
}
