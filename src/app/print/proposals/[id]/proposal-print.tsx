'use client';

import { useEffect } from 'react';
import { useProposal } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { ProposalDocument } from '@/components/proposals/proposal-document';
import { PrintToolbar } from '@/components/records/print-toolbar';
import { PageSkeleton } from '@/components/ui/misc';

export function ProposalPrint({ id }: { id: string }) {
  const { settings } = useWorkspace();
  const { data: proposal, isLoading } = useProposal(id);
  // Browsers name the saved PDF after the page title.
  useEffect(() => {
    if (proposal) document.title = `${proposal.title} (v${proposal.version})`;
  }, [proposal]);
  if (isLoading) return <PageSkeleton />;
  if (!proposal) return <p>Proposal not found.</p>;
  return (
    <>
      <PrintToolbar note={proposal.status === 'draft' ? 'This is a draft: the printout is watermarked “DRAFT”. Approve it to print a clean copy.' : undefined} />
      <ProposalDocument title={proposal.title} status={proposal.status} content={proposal.content} currency={proposal.currency} brand={settings.agency} />
    </>
  );
}
