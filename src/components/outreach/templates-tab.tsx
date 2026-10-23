'use client';

import { FileText, Plus, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import * as messaging from '@/lib/data/messaging-services';
import {
  MESSAGE_CHANNELS,
  MESSAGE_CHANNEL_LABELS,
  MESSAGE_PURPOSES,
  MESSAGE_PURPOSE_LABELS,
  TEMPLATE_STATUS_META,
  TEMPLATE_VARIABLES,
  validateTemplate,
  type MessageChannel,
  type MessagePurpose,
  type MessageTemplate,
  type TemplateStatus,
} from '@/lib/domain/messaging';
import { fieldErrors } from '@/lib/domain/schemas';
import { errorMessage, formatDateTime } from '@/lib/utils';
import { useAction, useTemplates } from '@/lib/workspace/hooks';
import { syncTemplatesOnServer } from '@/lib/workspace/messaging';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { EmptyState, Notice } from '@/components/ui/misc';

const EMAIL_EXAMPLE = `Hello {{business_name}} team,

Thank you for agreeing to hear from us. I'm {{sender_name}} from {{agency_name}}. We looked at how customers find you online and noted a few ideas that could help.

Would a 15-minute call next week suit you? If not, just reply and we will not follow up.

{{sender_name}}
{{agency_phone}}`;

export function TemplatesTab() {
  const { workspace, can } = useWorkspace();
  const qc = useQueryClient();
  const { data: templates = [] } = useTemplates();
  const [editing, setEditing] = useState<MessageTemplate | 'new' | null>(null);
  const [syncing, setSyncing] = useState(false);
  const setStatus = useAction((ctx, t: MessageTemplate, status: TemplateStatus) => messaging.setTemplateStatus(ctx, t, status), { success: 'Template updated' });
  const manage = can('templates.manage');

  async function sync() {
    setSyncing(true);
    try {
      const r = await syncTemplatesOnServer();
      toast.success(`Synchronised: ${r.updated} updated, ${r.added} added, ${r.missing} not found at Meta`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSyncing(false);
      await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === workspace.organizationId });
    }
  }

  return (
    <Card>
      <CardHeader
        title="Message templates"
        description="Email templates are approved by an owner or admin. WhatsApp templates are written and submitted in WhatsApp Manager; their status here comes only from Meta."
        actions={
          manage ? (
            <>
              {workspace.mode === 'cloud' && (
                <Button size="sm" loading={syncing} onClick={() => void sync()} title="Reads template names, text and review status from your WhatsApp Business Account. Free; nothing is submitted.">
                  <RefreshCw aria-hidden /> Sync WhatsApp templates
                </Button>
              )}
              <Button size="sm" onClick={() => setEditing('new')}>
                <Plus aria-hidden /> New template
              </Button>
            </>
          ) : null
        }
      />
      {templates.length === 0 ? (
        <EmptyState icon={FileText} title="No templates yet" description="Business-initiated messages use an approved template. Start with an email introduction for prospects who agreed to hear from you." />
      ) : (
        <ul className="divide-y divide-border">
          {templates.map((t) => {
            const v = validateTemplate(t);
            const meta = TEMPLATE_STATUS_META[t.status];
            return (
              <li key={t.id} className="space-y-2 px-4 py-3" data-testid="message-template">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{t.name}</p>
                    <p className="text-xs text-subtle">
                      {MESSAGE_CHANNEL_LABELS[t.channel]} · {MESSAGE_PURPOSE_LABELS[t.purpose]} · {t.language} · version {t.version}
                      {t.providerTemplateName ? ` · ${t.providerTemplateName}` : ''}
                      {t.providerCategory ? ` · ${t.providerCategory.toLowerCase()}` : ''}
                      {t.statusCheckedAt ? ` · checked ${formatDateTime(t.statusCheckedAt)}` : ''}
                    </p>
                  </div>
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                </div>
                {t.subject && <p className="text-sm font-medium">{t.subject}</p>}
                <p className="line-clamp-3 whitespace-pre-wrap text-sm text-muted">{t.body}</p>
                {t.statusReason && <p className="text-xs text-warning">{t.statusReason}</p>}
                {v.errors.map((e) => (
                  <p key={e} className="text-xs text-danger">
                    {e}
                  </p>
                ))}
                {v.warnings.map((w) => (
                  <p key={w} className="text-xs text-warning">
                    {w}
                  </p>
                ))}
                {manage && (
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>
                      Edit
                    </Button>
                    {t.channel === 'email' && t.status === 'draft' && (
                      <Button size="sm" disabled={v.errors.length > 0} loading={setStatus.pending} onClick={() => void setStatus.run(t, 'approved')}>
                        Approve template
                      </Button>
                    )}
                    {t.channel === 'email' && t.status === 'approved' && (
                      <Button size="sm" variant="ghost" onClick={() => void setStatus.run(t, 'paused')}>
                        Pause
                      </Button>
                    )}
                    {t.channel === 'email' && t.status === 'paused' && (
                      <Button size="sm" variant="ghost" onClick={() => void setStatus.run(t, 'approved')}>
                        Resume
                      </Button>
                    )}
                    {t.status !== 'disabled' ? (
                      <Button size="sm" variant="ghost" onClick={() => void setStatus.run(t, 'disabled')}>
                        Disable
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => void setStatus.run(t, t.channel === 'email' ? 'draft' : 'pending')}>
                        Re-enable
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {editing && <TemplateDialog template={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function TemplateDialog({ template, onClose }: { template: MessageTemplate | null; onClose: () => void }) {
  const [channel, setChannel] = useState<MessageChannel>(template?.channel ?? 'email');
  const [name, setName] = useState(template?.name ?? '');
  const [purpose, setPurpose] = useState<MessagePurpose>(template?.purpose ?? 'introduction');
  const [language, setLanguage] = useState(template?.language ?? 'en');
  const [subject, setSubject] = useState(template?.subject ?? '');
  const [body, setBody] = useState(template?.body ?? (template ? '' : EMAIL_EXAMPLE));
  const [providerTemplateName, setProviderTemplateName] = useState(template?.providerTemplateName ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useAction((ctx, form: messaging.TemplateForm) => messaging.saveTemplate(ctx, form, template), {
    success: template && template.status !== 'draft' ? 'Template saved; edited content needs approval again' : 'Template saved as a draft',
    onSuccess: onClose,
  });
  const v = validateTemplate({ channel, subject: channel === 'email' ? subject : null, body, providerTemplateName: channel === 'whatsapp' ? providerTemplateName : null, purpose });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = messaging.templateFormSchema.safeParse({ channel, name, purpose, language, subject, body, providerTemplateName });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    await save.run(parsed.data);
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={template ? 'Edit template' : 'New template'}
      description="Templates are saved as drafts. Changing the text of an approved template sends it back for approval."
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="template-form" loading={save.pending}>
            Save template
          </Button>
        </>
      }
    >
      <form id="template-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Channel" required>
          {(p) => (
            <Select {...p} value={channel} disabled={Boolean(template)} onChange={(e) => setChannel(e.target.value as MessageChannel)}>
              {MESSAGE_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {MESSAGE_CHANNEL_LABELS[c]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Template name" required error={errors.name}>
          {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />}
        </Field>
        <Field label="Purpose" required>
          {(p) => (
            <Select {...p} value={purpose} onChange={(e) => setPurpose(e.target.value as MessagePurpose)}>
              {MESSAGE_PURPOSES.map((x) => (
                <option key={x} value={x}>
                  {MESSAGE_PURPOSE_LABELS[x]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Language code" required error={errors.language} hint="As in WhatsApp Manager, for example en or en_US.">
          {(p) => <Input {...p} value={language} onChange={(e) => setLanguage(e.target.value)} maxLength={6} />}
        </Field>
        {channel === 'email' ? (
          <Field label="Subject" required error={errors.subject} className="sm:col-span-2">
            {(p) => <Input {...p} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />}
          </Field>
        ) : (
          <Field label="WhatsApp template name" required error={errors.providerTemplateName} hint="Exactly as approved in WhatsApp Manager. Use named parameters such as {{business_name}}." className="sm:col-span-2">
            {(p) => <Input {...p} value={providerTemplateName} onChange={(e) => setProviderTemplateName(e.target.value)} maxLength={512} />}
          </Field>
        )}
        <Field label="Message" required error={errors.body} className="sm:col-span-2" hint={`Variables: ${Object.keys(TEMPLATE_VARIABLES).map((k) => `{{${k}}}`).join(' ')}`}>
          {(p) => <Textarea {...p} rows={10} value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} />}
        </Field>
        {(v.errors.length > 0 || v.warnings.length > 0) && (
          <Notice tone={v.errors.length ? 'warning' : 'info'} title="Message rules" className="sm:col-span-2">
            <ul className="list-disc space-y-0.5 pl-4">
              {[...v.errors, ...v.warnings].map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </Notice>
        )}
      </form>
    </Dialog>
  );
}
