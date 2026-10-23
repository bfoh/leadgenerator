'use client';

import { useState } from 'react';
import { MAX_LOGO_DATA_URL, type OrgSettings } from '@/lib/domain/settings';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/field';
import { ObjectListEditor } from '@/components/ui/list-editor';
import { useSaveSettings } from './use-save-settings';

type Tax = OrgSettings['defaultTaxes'][number];

export function AgencyTab() {
  const { settings, workspace, can } = useWorkspace();
  const editable = can('settings.manage');
  const [orgName, setOrgName] = useState(workspace.organizationName);
  const [agency, setAgency] = useState(settings.agency);
  const [validity, setValidity] = useState(String(settings.proposalValidityDays));
  const [retention, setRetention] = useState(String(settings.contactRetentionDays));
  const [minConfidence, setMinConfidence] = useState(String(settings.reportMinConfidence));
  const [taxes, setTaxes] = useState<Tax[]>(settings.defaultTaxes);
  const [logoError, setLogoError] = useState<string | null>(null);
  const save = useSaveSettings('Agency settings saved');
  const set = (key: keyof typeof agency, value: string) => setAgency((a) => ({ ...a, [key]: value }));

  return (
    <form
      noValidate
      className="grid grid-cols-1 gap-5 lg:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        save.run({ ...settings, agency, proposalValidityDays: Number(validity), contactRetentionDays: Number(retention), reportMinConfidence: Number(minConfidence), defaultTaxes: taxes }, { organizationName: orgName });
      }}
    >
      <Card>
        <CardHeader title="Agency profile" description="Shown on proposals. Leave blank anything you do not want printed." />
        <CardBody>
          <fieldset disabled={!editable} className="grid gap-4 sm:grid-cols-2">
            <Field label="Workspace name" className="sm:col-span-2" hint="Shown in the sidebar.">
              {(p) => <Input {...p} value={orgName} onChange={(e) => setOrgName(e.target.value)} maxLength={120} />}
            </Field>
            <Field label="Agency name (on proposals)" className="sm:col-span-2">
              {(p) => <Input {...p} value={agency.name} onChange={(e) => set('name', e.target.value)} maxLength={120} />}
            </Field>
            <Field label="Email">{(p) => <Input {...p} type="email" value={agency.email} onChange={(e) => set('email', e.target.value)} maxLength={200} />}</Field>
            <Field label="Phone">{(p) => <Input {...p} type="tel" value={agency.phone} onChange={(e) => set('phone', e.target.value)} maxLength={60} />}</Field>
            <Field label="Website">{(p) => <Input {...p} type="url" value={agency.website} onChange={(e) => set('website', e.target.value)} maxLength={300} />}</Field>
            <Field label="Address">{(p) => <Input {...p} value={agency.address} onChange={(e) => set('address', e.target.value)} maxLength={300} />}</Field>
          </fieldset>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Proposal branding" description="Printed on proposals and their PDF. Leave empty for a plain layout." />
        <CardBody>
          <fieldset disabled={!editable} className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Accent colour" hint="Headings rule, cover band and table header.">
                {(p) => (
                  <Input
                    {...p}
                    type="color"
                    value={agency.accentColor || '#1f3a5f'}
                    onChange={(e) => set('accentColor', e.target.value)}
                    className="h-9 w-20 p-1"
                  />
                )}
              </Field>
              <span className="pb-2 text-xs text-subtle">{agency.accentColor ? agency.accentColor.toUpperCase() : 'Default (no accent)'}</span>
              {agency.accentColor && (
                <Button size="sm" variant="ghost" onClick={() => set('accentColor', '')}>
                  Use default
                </Button>
              )}
            </div>
            <Field label="Logo" hint="PNG, JPEG or WebP, up to about 140 KB. Stored with your workspace settings." error={logoError ?? undefined}>
              {(p) => (
                <Input
                  {...p}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return setLogoError('Choose a PNG, JPEG or WebP image.');
                    const reader = new FileReader();
                    reader.onload = () => {
                      const url = String(reader.result ?? '');
                      if (url.length > MAX_LOGO_DATA_URL) return setLogoError('That image is too large. Use one under about 140 KB.');
                      setLogoError(null);
                      set('logoDataUrl', url);
                    };
                    reader.onerror = () => setLogoError('The image could not be read.');
                    reader.readAsDataURL(file);
                  }}
                />
              )}
            </Field>
            {agency.logoDataUrl && (
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element -- a data URL from settings, not an optimisable asset */}
                <img src={agency.logoDataUrl} alt="Current logo" className="h-10 w-auto max-w-40 rounded border border-border bg-white object-contain p-1" />
                <Button size="sm" variant="ghost" onClick={() => set('logoDataUrl', '')}>
                  Remove logo
                </Button>
              </div>
            )}
          </fieldset>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Proposal defaults" description="Applied to new proposals. Existing proposals keep their own copy." />
        <CardBody>
          <fieldset disabled={!editable} className="space-y-4">
            <Field label="Validity (days)" hint="How long a quotation stays open.">
              {(p) => <Input {...p} type="number" min={1} max={365} value={validity} onChange={(e) => setValidity(e.target.value)} className="w-32" />}
            </Field>
            <Field label="Default terms" hint="Payment, ownership, revisions and cancellation terms. Have them reviewed before relying on them.">
              {(p) => <Textarea {...p} rows={6} value={agency.defaultTerms} onChange={(e) => set('defaultTerms', e.target.value)} maxLength={4000} />}
            </Field>
            <ObjectListEditor<Tax>
              label="Default taxes and levies"
              hint="Nothing is applied unless you add it. Which taxes apply (e.g. VAT, NHIL, GETFund levy) depends on your registration — confirm with your accountant."
              items={taxes}
              onChange={setTaxes}
              disabled={!editable}
              create={() => ({ label: '', ratePercent: 0 })}
              itemLabel={(t, i) => t.label || `Tax ${i + 1}`}
              fields={[
                { key: 'label', label: 'Label', kind: 'text' },
                { key: 'ratePercent', label: 'Rate (%)', kind: 'number' },
              ]}
            />
          </fieldset>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Contact data" description="How long contact details are kept before they come up for review or deletion (data minimisation)." />
        <CardBody>
          <fieldset disabled={!editable} className="space-y-4">
            <Field label="Keep contact details for (days)" hint="Applies to details recorded from now on; each detail keeps its own deadline. 30 to 1,095 days.">
              {(p) => <Input {...p} type="number" min={30} max={1095} value={retention} onChange={(e) => setRetention(e.target.value)} className="w-32" />}
            </Field>
            <p className="text-xs text-subtle">The suppression list is never deleted: it keeps only a one-way hash and a masked hint of each value, so opt-outs keep working.</p>
          </fieldset>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Automatic reports" description="When the Opportunity Report agent may write a report without being asked." />
        <CardBody>
          <fieldset disabled={!editable} className="space-y-4">
            <Field label="Minimum research confidence (0–100)" hint="Below this, or before the website is verified, the agent asks for more research instead of writing a report. People can still write one from the prospect’s Reports tab.">
              {(p) => <Input {...p} type="number" min={0} max={100} value={minConfidence} onChange={(e) => setMinConfidence(e.target.value)} className="w-32" />}
            </Field>
            <p className="text-xs text-subtle">AI-assisted reports also need an Anthropic budget (Automation Center → Controls) and stay within the server’s daily AI report quota; otherwise the agent writes the free rule-based report.</p>
          </fieldset>
        </CardBody>
      </Card>
      {editable && (
        <div className="lg:col-span-2">
          <Button type="submit" variant="primary" loading={save.pending}>
            Save agency settings
          </Button>
        </div>
      )}
    </form>
  );
}
