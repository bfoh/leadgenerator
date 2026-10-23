// The AI-written {{personal_note}} (phase 8): its structured-output schema and the checks applied
// after the model answers. The note must cite evidence items that exist and pass the same rules as
// a note a person writes (validatePersonalNote). Anything else is discarded, never sent: the draft
// still needs a person's review and approval, and the eligibility gateway decides if it may go.

import { z } from 'zod';
import type { EvidencePack } from './evidence';
import { validatePersonalNote } from './messaging';

export const outreachNoteDraftSchema = z.object({
  /** True when the evidence does not support a specific, accurate sentence. */
  insufficient: z.boolean(),
  note: z.string().max(400),
  evidenceIds: z.array(z.string().max(5)).max(5),
});
export type OutreachNoteDraft = z.infer<typeof outreachNoteDraftSchema>;

export type GroundedNote = { ok: true; note: string; evidenceIds: string[] } | { ok: false; reason: string };

export function groundNote(draft: OutreachNoteDraft, pack: Pick<EvidencePack, 'items'>): GroundedNote {
  if (draft.insufficient) return { ok: false, reason: 'The research does not support a specific personal note yet.' };
  const known = new Set(pack.items.map((i) => i.id));
  const ids = [...new Set(draft.evidenceIds)].filter((id) => known.has(id));
  if (!ids.length) return { ok: false, reason: 'The note did not cite any recorded evidence.' };
  const note = draft.note.replace(/\s+/g, ' ').trim();
  const errors = validatePersonalNote(note);
  if (errors.length) return { ok: false, reason: `The note broke the message rules: ${errors.join(' ')}` };
  return { ok: true, note, evidenceIds: ids };
}
