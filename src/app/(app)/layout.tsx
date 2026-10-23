import { AppShell } from '@/components/shell/app-shell';
import { WorkspaceProvider } from '@/lib/workspace/workspace-provider';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProvider>
      <AppShell>{children}</AppShell>
    </WorkspaceProvider>
  );
}
