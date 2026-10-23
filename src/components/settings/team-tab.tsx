'use client';

import { Trash2, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { ROLES, ROLE_LABELS, type Role } from '@/lib/domain/constants';
import { formatDate } from '@/lib/utils';
import { useAction, useInvitations, useMembers } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/field';
import { EmptyState, Notice } from '@/components/ui/misc';

const ROLE_HELP: Record<Role, string> = {
  owner: 'Everything, including team and settings',
  admin: 'Everything, including team and settings',
  researcher: 'Discovery, prospects, verification and reports',
  sales: 'Prospects, contact, reports, proposals and projects',
  developer: 'Projects, tasks and activity notes',
  viewer: 'Read-only access',
};

export function TeamTab() {
  const { workspace } = useWorkspace();
  if (workspace.mode === 'demo') {
    return (
      <Notice tone="neutral" title="Team members need cloud mode">
        The demo workspace is a single local user. Connect Supabase (see the README) to invite researchers, sales and developers with their own roles.
      </Notice>
    );
  }
  return <CloudTeam />;
}

function CloudTeam() {
  const { workspace, can } = useWorkspace();
  const manage = can('members.manage');
  const { data: members = [], isLoading } = useMembers();
  const { data: invitations = [] } = useInvitations();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('researcher');
  const [error, setError] = useState<string>();
  const invite = useAction((ctx, e: string, r: Role) => ctx.store.createInvitation(e, r), { success: 'Invitation recorded' });
  const cancel = useAction((ctx, id: string) => ctx.store.deleteInvitation(id), { success: 'Invitation cancelled' });
  const changeRole = useAction((ctx, userId: string, r: Role) => ctx.store.updateMemberRole(userId, r), { success: 'Role updated' });
  const remove = useAction((ctx, userId: string) => ctx.store.removeMember(userId), { success: 'Member removed' });

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Card className="overflow-hidden">
        <CardHeader title="Members" description={`${members.length} in ${workspace.organizationName}`} />
        {isLoading ? null : members.length === 0 ? (
          <EmptyState title="No members visible" className="py-8" />
        ) : (
          <ul className="divide-y divide-border">
            {members.map((m) => {
              const self = m.userId === workspace.userId;
              return (
                <li key={m.userId} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {m.email ?? 'Unknown email'} {self && <span className="text-xs font-normal text-subtle">(you)</span>}
                    </p>
                    <p className="text-xs text-subtle">Joined {formatDate(m.createdAt)}</p>
                  </div>
                  {manage && !self ? (
                    <>
                      <Select aria-label={`Role for ${m.email ?? 'member'}`} value={m.role} onChange={(e) => changeRole.run(m.userId, e.target.value as Role)} className="w-auto">
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </Select>
                      <Button size="icon-sm" variant="ghost" aria-label={`Remove ${m.email ?? 'member'}`} onClick={() => remove.run(m.userId)}>
                        <Trash2 />
                      </Button>
                    </>
                  ) : (
                    <span className="text-xs text-muted">{ROLE_LABELS[m.role]}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <div className="space-y-5">
        {manage && (
          <Card>
            <CardHeader title="Invite a teammate" />
            <CardBody>
              <form
                noValidate
                className="space-y-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const parsed = z.email().safeParse(email.trim());
                  if (!parsed.success) return setError('Enter a valid email address');
                  setError(undefined);
                  if (await invite.run(parsed.data, role)) setEmail('');
                }}
              >
                <Field label="Email" error={error}>
                  {(p) => <Input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />}
                </Field>
                <Field label="Role" hint={ROLE_HELP[role]}>
                  {(p) => (
                    <Select {...p} value={role} onChange={(e) => setRole(e.target.value as Role)}>
                      {ROLES.filter((r) => r !== 'owner').map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Button type="submit" variant="primary" loading={invite.pending}>
                  <UserPlus className="size-4" aria-hidden /> Add invitation
                </Button>
                <p className="text-xs text-subtle">No email is sent. Ask them to sign in at this site with that address; they join with this role on first sign-in.</p>
              </form>
            </CardBody>
          </Card>
        )}
        <Card>
          <CardHeader title="Pending invitations" />
          {invitations.length === 0 ? (
            <EmptyState title="None pending" className="py-6" />
          ) : (
            <ul className="divide-y divide-border">
              {invitations.map((i) => (
                <li key={i.id} className="flex items-center gap-2 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{i.email}</p>
                    <p className="text-xs text-subtle">
                      {ROLE_LABELS[i.role]} · added {formatDate(i.createdAt)}
                    </p>
                  </div>
                  {manage && (
                    <Button size="icon-sm" variant="ghost" aria-label={`Cancel invitation for ${i.email}`} onClick={() => cancel.run(i.id)}>
                      <Trash2 />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
