import type { Metadata } from 'next';
import { ProposalEditor } from '@/components/proposals/proposal-editor';

export const metadata: Metadata = { title: 'Proposal' };

export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProposalEditor id={id} />;
}
