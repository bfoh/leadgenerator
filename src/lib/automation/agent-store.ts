// What agents may do with workspace data. The engine hands agents this wrapper instead of the real
// store, so no agent can record or change consent, lift a suppression, delete records, merge
// prospects, change contact permission (other than recording an opt-out), approve or issue a
// proposal, approve, queue or send a message, manage templates or the workspace — whatever its code
// or a page it read asks for. Suppression and opt-out always stay possible.

import type { DataStore } from '@/lib/data/store';
import type { Business } from '@/lib/domain/types';
import { AgentError } from './agents/types';

const FORBIDDEN: Partial<Record<keyof DataStore, string>> = {
  createConsentRecord: 'record consent',
  liftSuppression: 'lift a suppression',
  deleteContactPoints: 'delete contact details',
  deleteBusiness: 'delete a prospect',
  mergeBusinesses: 'merge prospects',
  undoMerge: 'undo a merge',
  deleteTask: 'delete tasks',
  deleteProposal: 'delete proposals',
  deleteMilestone: 'delete milestones',
  updateSettings: 'change workspace settings',
  createInvitation: 'invite members',
  deleteInvitation: 'withdraw invitations',
  updateMemberRole: 'change member roles',
  removeMember: 'remove members',
  createTemplate: 'manage message templates',
  updateTemplate: 'manage message templates',
  deleteTemplate: 'manage message templates',
  createMessagePolicy: 'set message policies',
  updateMessagePolicy: 'set message policies',
  recordMessageEvent: 'send messages or record their delivery',
  deleteOutreachMessage: 'delete messages',
  createInboundMessage: 'record received messages',
  updateInboundMessage: 'change received messages',
  createChangeRequest: 'record or decide proposal change requests',
  updateChangeRequest: 'record or decide proposal change requests',
};

const PROPOSAL_DECISION_FIELDS = ['approvedAt', 'approvedBy', 'sentAt', 'decidedAt'] as const;

const PERMISSION_FIELDS: readonly (keyof Business)[] = ['contactPermission', 'lawfulBasis', 'permissionEvidence', 'permissionRecordedAt', 'optedOutAt'];

export function agentStore(store: DataStore): DataStore {
  return new Proxy(store, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      const forbidden = FORBIDDEN[prop as keyof DataStore];
      if (forbidden) {
        return () => Promise.reject(new AgentError(`Agents may not ${forbidden}; a person has to do this.`, 'policy'));
      }
      // Proposals: agents create drafts only. Approval, issue and the client's decision belong to people.
      if (prop === 'createProposal') {
        return (input: Parameters<DataStore['createProposal']>[0]) =>
          input.status !== 'draft' || input.approvedAt || input.sentAt || input.decidedAt
            ? Promise.reject(new AgentError('Agents may only create draft proposals.', 'policy'))
            : target.createProposal(input);
      }
      if (prop === 'updateProposal') {
        return (id: string, patch: Parameters<DataStore['updateProposal']>[1]) =>
          (patch.status && patch.status !== 'draft') || PROPOSAL_DECISION_FIELDS.some((f) => patch[f] != null)
            ? Promise.reject(new AgentError('Agents may not approve, issue or decide proposals; a person has to do this.', 'policy'))
            : target.updateProposal(id, patch);
      }
      // Messages: agents draft (naming their version) and may cancel; approval and queueing belong to people.
      if (prop === 'createOutreachMessage') {
        return (input: Parameters<DataStore['createOutreachMessage']>[0]) =>
          input.agentVersion ? target.createOutreachMessage(input) : Promise.reject(new AgentError('Agent drafts name the agent version.', 'policy'));
      }
      if (prop === 'updateOutreachMessage') {
        return (id: string, patch: Parameters<DataStore['updateOutreachMessage']>[1]) =>
          (patch.status && patch.status !== 'draft' && patch.status !== 'cancelled') || patch.decisionId || patch.scheduledFor
            ? Promise.reject(new AgentError('Agents may not approve, queue or send messages; a person has to do this.', 'policy'))
            : target.updateOutreachMessage(id, patch);
      }
      // Replies: agents record rules or AI readings under their own name; corrections are people's.
      if (prop === 'createReplyClassification') {
        return (input: Parameters<DataStore['createReplyClassification']>[0]) =>
          input.source === 'person' ? Promise.reject(new AgentError('Agents may not record a person’s correction.', 'policy')) : target.createReplyClassification({ ...input, actorType: 'agent' });
      }
      if (prop === 'createDecision') {
        return (input: Parameters<DataStore['createDecision']>[0]) =>
          input.stage === 'preview' ? target.createDecision({ ...input, actorType: 'agent' }) : Promise.reject(new AgentError('Agents record preview decisions only.', 'policy'));
      }
      if (prop === 'updateBusiness') {
        return (id: string, patch: Partial<Business>) => {
          const touches = PERMISSION_FIELDS.some((f) => f in patch);
          if (touches && patch.contactPermission !== 'opted_out') {
            return Promise.reject(new AgentError('Agents may not change contact permission, except to record an opt-out.', 'policy'));
          }
          return target.updateBusiness(id, patch);
        };
      }
      return value.bind(target);
    },
  });
}
