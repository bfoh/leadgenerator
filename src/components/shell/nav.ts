import {
  BarChart3,
  BookUser,
  Bot,
  Building2,
  Compass,
  FileSignature,
  FileText,
  FolderKanban,
  KanbanSquare,
  LayoutDashboard,
  Library,
  Palette,
  Send,
  Settings,
  ShieldCheck,
} from 'lucide-react';

export const NAV = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/discover', label: 'Discover', icon: Compass },
  { href: '/prospects', label: 'Prospects', icon: Building2 },
  { href: '/verification', label: 'Verification queue', icon: ShieldCheck },
  { href: '/contacts', label: 'Contacts', icon: BookUser },
  { href: '/reports', label: 'Opportunity reports', icon: FileText },
  { href: '/proposals', label: 'Proposals', icon: FileSignature },
  { href: '/outreach', label: 'Outreach', icon: Send },
  { href: '/automation', label: 'Automation Center', icon: Bot },
  { href: '/pipeline', label: 'Sales pipeline', icon: KanbanSquare },
  { href: '/projects', label: 'Projects', icon: FolderKanban },
  { href: '/studio', label: 'Website concepts', icon: Palette },
  { href: '/library', label: 'Solution library', icon: Library },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/settings', label: 'Settings', icon: Settings },
] as const;

export function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}
