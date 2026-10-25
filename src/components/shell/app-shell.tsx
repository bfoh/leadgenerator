'use client';

import { Dialog as D } from 'radix-ui';
import { LogOut, Menu as MenuIcon, Search, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ROLE_LABELS } from '@/lib/domain/constants';
import { cn } from '@/lib/utils';
import { useBusinesses } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { Badge } from '@/components/ui/badge';
import { Kbd } from '@/components/ui/misc';
import { ThemeToggle } from '@/components/theme';
import { CommandPalette } from './command-palette';
import { NAV, isActive } from './nav';

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
      <span className="grid size-7 place-items-center rounded-md bg-foreground font-serif text-[15px] italic text-background" aria-hidden>
        d
      </span>
      <span className="leading-tight">
        <span className="block text-[13px] font-semibold">Opportunity Finder</span>
        <span className="block text-[11px] text-subtle">Ghana · 16 regions</span>
      </span>
    </Link>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { data: businesses } = useBusinesses();
  const queue = businesses?.filter((b) => b.websiteStatus === 'unverified' && b.stage !== 'archived').length ?? 0;
  return (
    <nav aria-label="Main" className="space-y-0.5">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-muted transition-colors hover:bg-surface-hover hover:text-foreground',
              active && 'bg-surface-hover font-medium text-foreground',
            )}
          >
            <Icon className={cn('size-4 text-subtle group-hover:text-foreground', active && 'text-accent')} aria-hidden />
            <span className="flex-1 truncate">{label}</span>
            {href === '/verification' && queue > 0 && <span className="rounded-full bg-surface-muted px-1.5 text-[11px] tabular text-subtle">{queue}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

function Account() {
  const { workspace } = useWorkspace();
  return (
    <div className="space-y-3 border-t border-border p-3">
      <div className="min-w-0 px-1">
        <p className="truncate text-[13px] font-medium">{workspace.organizationName}</p>
        <p className="truncate text-xs text-subtle">
          {workspace.email ?? 'Demo user'} · {ROLE_LABELS[workspace.role]}
        </p>
      </div>
      <div className="flex items-center justify-between gap-2">
        <ThemeToggle />
        {workspace.mode === 'cloud' && (
          <form action="/auth/signout" method="post">
            <button type="submit" className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-subtle hover:bg-surface-hover hover:text-foreground">
              <LogOut className="size-3.5" aria-hidden />
              Sign out
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function ModeBadge() {
  const { workspace } = useWorkspace();
  return workspace.mode === 'demo' ? (
    <Badge tone="warning" dot title="Data is stored only in this browser. Configure Supabase for a shared, signed-in workspace.">
      Demo workspace · this browser only
    </Badge>
  ) : (
    <Badge tone="success" dot>
      Cloud workspace
    </Badge>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <a href="#main" className="sr-only z-50 rounded-md bg-surface px-3 py-2 focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-border bg-surface lg:flex">
        <div className="p-3">
          <Brand />
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-3">
          <NavLinks />
        </div>
        <Account />
      </aside>

      <D.Root open={navOpen} onOpenChange={setNavOpen}>
        <D.Portal>
          <D.Overlay className="fixed inset-0 z-50 bg-[var(--overlay)] lg:hidden" />
          <D.Content className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-border bg-surface lg:hidden">
            <D.Title className="sr-only">Navigation</D.Title>
            <D.Description className="sr-only">Main navigation</D.Description>
            <div className="flex items-center justify-between p-3">
              <Brand />
              <D.Close className="rounded-md p-1.5 text-subtle hover:bg-surface-hover" aria-label="Close navigation">
                <X className="size-4" />
              </D.Close>
            </div>
            <div className="flex-1 overflow-y-auto px-3 pb-3">
              <NavLinks onNavigate={() => setNavOpen(false)} />
            </div>
            <Account />
          </D.Content>
        </D.Portal>
      </D.Root>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-13 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur sm:px-6">
          <button type="button" onClick={() => setNavOpen(true)} className="-ml-1 rounded-md p-1.5 text-muted hover:bg-surface-hover lg:hidden" aria-label="Open navigation">
            <MenuIcon className="size-5" />
          </button>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex h-8 w-full max-w-sm items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-left text-[13px] text-subtle shadow-xs hover:border-border-strong"
            aria-label="Search records and commands"
          >
            <Search className="size-3.5" aria-hidden />
            <span className="flex-1 truncate">Search prospects, proposals, pages…</span>
            <span className="hidden sm:inline">
              <Kbd>⌘K</Kbd>
            </span>
          </button>
          <div className="ml-auto hidden md:block">
            <ModeBadge />
          </div>
        </header>
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1400px] flex-1 overflow-x-clip px-4 py-6 focus:outline-none sm:px-6 lg:px-8">
          <div className="mb-4 md:hidden">
            <ModeBadge />
          </div>
          {children}
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
