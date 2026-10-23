// UI mirror of the role checks enforced by RLS in supabase/migrations/002. RLS is authoritative;
// this only decides which controls to show.

import type { Role } from './constants';

export type Capability =
  | 'prospects.write'
  | 'records.delete'
  | 'verification.write'
  | 'activities.write'
  | 'reports.write'
  | 'proposals.write'
  | 'projects.write'
  | 'discovery.run'
  | 'settings.manage'
  | 'members.manage'
  | 'data.export'
  | 'automation.run'
  | 'automation.manage'
  | 'identity.merge'
  | 'scores.override'
  | 'contacts.write'
  | 'contacts.delete'
  | 'consent.record'
  | 'suppression.lift'
  | 'outreach.write'
  | 'outreach.approve'
  | 'templates.manage'
  | 'proposals.negotiate';

const MATRIX: Record<Capability, readonly Role[]> = {
  'prospects.write': ['owner', 'admin', 'researcher', 'sales'],
  'records.delete': ['owner', 'admin'],
  'verification.write': ['owner', 'admin', 'researcher', 'sales'],
  'activities.write': ['owner', 'admin', 'researcher', 'sales', 'developer'],
  'reports.write': ['owner', 'admin', 'researcher', 'sales'],
  'proposals.write': ['owner', 'admin', 'sales'],
  'projects.write': ['owner', 'admin', 'sales', 'developer'],
  'discovery.run': ['owner', 'admin', 'researcher', 'sales'],
  'settings.manage': ['owner', 'admin'],
  'members.manage': ['owner', 'admin'],
  'data.export': ['owner', 'admin', 'researcher', 'sales'],
  'automation.run': ['owner', 'admin', 'researcher', 'sales'],
  'automation.manage': ['owner', 'admin'],
  'identity.merge': ['owner', 'admin'],
  'scores.override': ['owner', 'admin', 'researcher'],
  'contacts.write': ['owner', 'admin', 'researcher', 'sales'],
  'contacts.delete': ['owner', 'admin'],
  'consent.record': ['owner', 'admin', 'sales'],
  'suppression.lift': ['owner', 'admin'],
  // Messaging (migration 006): drafting, checking and cancelling; approval and dispatch; templates.
  'outreach.write': ['owner', 'admin', 'sales'],
  'outreach.approve': ['owner', 'admin'],
  'templates.manage': ['owner', 'admin'],
  // Replies and conversion (migration 008): commercial changes a client asks for are decided by owners and admins.
  'proposals.negotiate': ['owner', 'admin'],
};

export function can(role: Role | null | undefined, capability: Capability): boolean {
  return Boolean(role && MATRIX[capability].includes(role));
}
