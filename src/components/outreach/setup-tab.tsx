'use client';

import { CheckCircle2, CircleAlert, OctagonX } from 'lucide-react';
import { useState } from 'react';
import { MODE_META } from '@/lib/automation/constants';
import { saveSettings } from '@/lib/data/services';
import { agencyIdentityIssues, type MessageChannel } from '@/lib/domain/messaging';
import { useAction } from '@/lib/workspace/hooks';
import { useAutomationSettings } from '@/lib/workspace/automation';
import { useMessagingEnv } from '@/lib/workspace/messaging';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { StringListEditor } from '@/components/ui/list-editor';
import { DefinitionList, Notice } from '@/components/ui/misc';

// What has to be true before any message can leave, and what is still missing. The checklist is
// information for the owner (OUTREACH_COMPLIANCE §6), not something the app can tick off.

const CHECKLIST = [
  'Ghanaian counsel has reviewed the outreach compliance rules and the consent wording.',
  'The Data Protection Commission registration covers prospect research and marketing.',
  'A dedicated sending subdomain has SPF, DKIM and DMARC (p=quarantine) and is verified in Resend.',
  'The WhatsApp Business Account is verified and its templates are approved by Meta.',
  'Webhook secrets are configured and delivery, bounce and complaint events were tested with sandbox recipients.',
  'The consent capture form is live and stores the wording people agree to.',
  'The sending policy (quiet hours, sending days, daily limits, per-recipient spacing) and each message policy were reviewed against counsel’s advice (Outreach → Policies).',
  'The opt-out keywords cover the languages prospects reply in (English, Twi, Ga, Ewe, Hausa as needed).',
  'An owner lifts the emergency stop with a recorded reason (possible only once a later version enables outreach).',
];

function Issues({ channel, issues }: { channel: MessageChannel; issues: string[] }) {
  return issues.length ? (
    <ul className="space-y-1 text-sm" aria-label={`${channel} configuration problems`}>
      {issues.map((i) => (
        <li key={i} className="flex gap-2">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <span className="text-muted">{i}</span>
        </li>
      ))}
    </ul>
  ) : (
    <p className="flex gap-2 text-sm">
      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> Configured.
    </p>
  );
}

export function SetupTab() {
  const { workspace, ctx, can } = useWorkspace();
  const { data: automation } = useAutomationSettings();
  const { status } = useMessagingEnv();
  const [recipients, setRecipients] = useState<string[]>(ctx.settings.messagingTestRecipients);
  const save = useAction((c, list: string[]) => saveSettings(c, { ...c.settings, messagingTestRecipients: list.map((r) => r.trim()).filter(Boolean) }), { success: 'Sandbox test recipients saved' });
  const demo = workspace.mode === 'demo';

  return (
    <div className="space-y-5">
      <Notice tone="warning" icon={OctagonX} title="Messages to businesses are off in this version">
        The eligibility gateway blocks every message to a business: the outreach modes cannot be selected and the emergency stop cannot be lifted. Only the agency’s own sandbox test recipients can receive messages{demo ? ', and in demo mode even those are simulated' : ''}.
      </Notice>

      <Card>
        <CardHeader title="Policy" as="h3" />
        <CardBody>
          <DefinitionList
            items={[
              { label: 'Workspace mode', value: automation ? MODE_META[automation.mode].label : 'Research only (automation tables not installed)' },
              { label: 'Emergency stop', value: automation && !automation.outboundStopped ? 'Lifted' : 'Engaged' },
              { label: 'Sending', value: automation?.sendingPaused ? `Paused: ${automation.sendingPauseReason ?? 'no reason recorded'}` : 'Not paused' },
              { label: 'Messages to businesses', value: 'Not available in this version' },
              { label: 'Sandbox sends', value: demo ? 'Simulated in the browser; nothing is sent' : 'Server, to MESSAGING_TEST_RECIPIENTS only' },
            ]}
          />
        </CardBody>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Email (Resend)" as="h3" description={demo ? 'Demo mode uses a simulated provider.' : 'Server environment variables; values are never shown here.'} />
          <CardBody className="space-y-3">
            <Issues channel="email" issues={demo ? agencyIdentityIssues(ctx.settings, 'email') : [...(status?.email.issues ?? []), ...agencyIdentityIssues(ctx.settings, 'email')]} />
            {!demo && <p className="text-xs text-subtle">Webhook endpoint for Resend: APP_URL + /api/webhooks/email (events: sent, delivered, delivery delayed, bounced, complained, failed, suppressed, received).</p>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="WhatsApp (Cloud API)" as="h3" description={demo ? 'Demo mode uses a simulated provider.' : `Official WhatsApp Business Platform, Graph ${status?.whatsapp.graphVersion ?? ''}.`} />
          <CardBody className="space-y-3">
            <Issues channel="whatsapp" issues={demo ? agencyIdentityIssues(ctx.settings, 'whatsapp') : [...(status?.whatsapp.issues ?? []), ...agencyIdentityIssues(ctx.settings, 'whatsapp')]} />
            {!demo && <p className="text-xs text-subtle">Callback URL for Meta: APP_URL + /api/webhooks/whatsapp (subscribe to the “messages” field; the verify token is WHATSAPP_VERIFY_TOKEN).</p>}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Sandbox test recipients"
          as="h3"
          description="The agency’s own addresses and numbers, used to test sending, delivery tracking and replies end to end. A prospect’s contact detail never belongs here."
        />
        <CardBody className="space-y-3">
          {demo ? (
            <>
              <StringListEditor
                label="Test addresses and numbers"
                items={recipients}
                onChange={setRecipients}
                placeholder="you@youragency.com or +233…"
                disabled={!can('settings.manage')}
                hint="Demo only. To test the whole flow, record one of these as a contact point on a test prospect, with consent and a validation."
              />
              {can('settings.manage') && (
                <Button size="sm" loading={save.pending} onClick={() => void save.run(recipients)}>
                  Save test recipients
                </Button>
              )}
            </>
          ) : status?.testRecipients.hints.length ? (
            <ul className="space-y-1 text-sm">
              {status.testRecipients.hints.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">None configured. Set MESSAGING_TEST_RECIPIENTS on the server (comma-separated, at most 10).</p>
          )}
          {!demo && <p className="text-xs text-subtle">Received messages are filed in the workspace named by MESSAGING_ORGANIZATION_ID{status?.inbound.organizationConfigured ? '' : ' (not set yet)'}.</p>}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Before messages to businesses can be enabled" as="h3" description="For the owner and counsel. A later version enables outreach only after these are done." />
        <CardBody>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
            {CHECKLIST.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ol>
        </CardBody>
      </Card>
    </div>
  );
}
