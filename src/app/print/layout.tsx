import { WorkspaceProvider } from '@/lib/workspace/workspace-provider';

export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProvider>
      <main className="mx-auto max-w-3xl bg-surface px-6 py-10 print:max-w-none print:p-0">{children}</main>
    </WorkspaceProvider>
  );
}
