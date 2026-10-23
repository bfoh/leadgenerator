import type { Metadata } from 'next';
import { ContactsWorkspace } from '@/components/contacts/contacts-workspace';

export const metadata: Metadata = { title: 'Contacts' };

export default function ContactsPage() {
  return <ContactsWorkspace />;
}
