import type { Metadata } from 'next';
import { ProposalsList } from '@/components/proposals/proposals-list';

export const metadata: Metadata = { title: 'Proposals' };

export default function ProposalsPage() {
  return <ProposalsList />;
}
