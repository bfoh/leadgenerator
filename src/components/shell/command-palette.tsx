'use client';

import { Command } from 'cmdk';
import { Building2, FileSignature, FolderKanban, Plus } from 'lucide-react';
import { Dialog as D } from 'radix-ui';
import { useRouter } from 'next/navigation';
import { STAGE_LABELS } from '@/lib/domain/constants';
import { useBusinesses, useProjects, useProposals } from '@/lib/workspace/hooks';
import { NAV } from './nav';

const item = 'flex cursor-default items-center gap-2.5 rounded-md px-2.5 py-2 text-sm aria-selected:bg-surface-hover [&_svg]:size-4 [&_svg]:text-subtle';
const group = 'px-1 py-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-subtle';

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const { data: businesses = [] } = useBusinesses();
  const { data: proposals = [] } = useProposals();
  const { data: projects = [] } = useProjects();
  const names = new Map(businesses.map((b) => [b.id, b.name]));

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-[var(--overlay)]" />
        <D.Content className="fixed left-1/2 top-[12vh] z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
          <D.Title className="sr-only">Search</D.Title>
          <D.Description className="sr-only">Search records, pages and actions</D.Description>
          <Command label="Search records and commands" loop>
            <Command.Input placeholder="Search prospects, proposals, projects or pages…" className="h-12 w-full border-b border-border bg-transparent px-4 text-sm outline-none placeholder:text-subtle" />
            <Command.List className="max-h-[60vh] overflow-y-auto p-1">
              <Command.Empty className="px-4 py-8 text-center text-sm text-subtle">No matches.</Command.Empty>
              <Command.Group heading="Actions" className={group}>
                <Command.Item className={item} onSelect={() => go('/prospects?new=1')}>
                  <Plus /> Add research candidate
                </Command.Item>
                <Command.Item className={item} onSelect={() => go('/discover')}>
                  <Plus /> Run discovery search
                </Command.Item>
              </Command.Group>
              <Command.Group heading="Pages" className={group}>
                {NAV.map(({ href, label, icon: Icon }) => (
                  <Command.Item key={href} value={`page ${label}`} className={item} onSelect={() => go(href)}>
                    <Icon /> {label}
                  </Command.Item>
                ))}
              </Command.Group>
              {businesses.length > 0 && (
                <Command.Group heading="Prospects" className={group}>
                  {businesses.map((b) => (
                    <Command.Item key={b.id} value={`${b.name} ${b.city} ${b.category} ${b.id}`} className={item} onSelect={() => go(`/prospects/${b.id}`)}>
                      <Building2 />
                      <span className="flex-1 truncate">{b.name}</span>
                      <span className="shrink-0 text-xs text-subtle">
                        {b.city} · {STAGE_LABELS[b.stage]}
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {proposals.length > 0 && (
                <Command.Group heading="Proposals" className={group}>
                  {proposals.map((p) => (
                    <Command.Item key={p.id} value={`${p.title} ${names.get(p.businessId) ?? ''} ${p.id}`} className={item} onSelect={() => go(`/proposals/${p.id}`)}>
                      <FileSignature />
                      <span className="flex-1 truncate">{p.title}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {projects.length > 0 && (
                <Command.Group heading="Projects" className={group}>
                  {projects.map((p) => (
                    <Command.Item key={p.id} value={`${p.name} ${p.id}`} className={item} onSelect={() => go(`/projects/${p.id}`)}>
                      <FolderKanban />
                      <span className="flex-1 truncate">{p.name}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
