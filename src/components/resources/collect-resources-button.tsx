'use client';
import { FolderSearch } from 'lucide-react';
import { ButtonLink } from '@/components/ui/button';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
export function CollectResourcesButton({ businessId }: { businessId: string }) {
  const { can } = useWorkspace();
  if (!can('studio.write')) return null;
  return <ButtonLink href={`/prospects/${businessId}/resources`} variant="primary"><FolderSearch aria-hidden /> Collect Business Resources</ButtonLink>;
}
