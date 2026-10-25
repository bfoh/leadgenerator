'use client';

import { Palette } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as studio from '@/lib/data/studio-services';
import type { Business } from '@/lib/domain/types';
import { useAction, useStudioProjects } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { Button, ButtonLink } from '@/components/ui/button';

/**
 * On a prospect: opens the concept that already exists, or starts one. One live concept per
 * prospect, so an archived concept does not hide the button.
 */
export function StudioConceptButton({ business }: { business: Business }) {
  const { can } = useWorkspace();
  const router = useRouter();
  const { data: projects = [] } = useStudioProjects(business.id);
  const live = projects.find((p) => p.status !== 'archived');
  const create = useAction((ctx) => studio.createStudioConcept(ctx, business), {
    success: 'Website concept started',
    onSuccess: (project) => router.push(`/studio/${project.id}`),
  });

  if (live) {
    return (
      <ButtonLink href={`/studio/${live.id}`}>
        <Palette aria-hidden /> Website concept
      </ButtonLink>
    );
  }
  if (!can('studio.write')) return null;
  return (
    <Button loading={create.pending} onClick={() => void create.run()}>
      <Palette aria-hidden /> Create website concept
    </Button>
  );
}
