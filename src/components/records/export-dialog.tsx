'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { toCsv } from '@/lib/csv';
import { CONTACT_PERMISSION_META, STAGE_LABELS, WEBSITE_STATUS_META } from '@/lib/domain/constants';
import type { Business } from '@/lib/domain/types';
import { download, errorMessage, todayIso } from '@/lib/utils';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/field';
import { Notice } from '@/components/ui/misc';

/**
 * CSV export of stored prospect records. Contact details are excluded unless the user opts in,
 * and every export is written to the insert-only usage log as an audit record.
 */
export function ExportDialog({ open, onOpenChange, businesses, scope }: { open: boolean; onOpenChange: (open: boolean) => void; businesses: Business[]; scope: string }) {
  const { store } = useWorkspace();
  const [includeContacts, setIncludeContacts] = useState(false);
  const [pending, setPending] = useState(false);

  async function run() {
    setPending(true);
    try {
      const rows = businesses;
      const csv = toCsv(rows, [
        { header: 'Name', value: (b) => b.name },
        { header: 'Category', value: (b) => b.category },
        { header: 'City', value: (b) => b.city },
        { header: 'Region', value: (b) => b.region },
        { header: 'Neighbourhood', value: (b) => b.neighborhood },
        { header: 'Website status', value: (b) => WEBSITE_STATUS_META[b.websiteStatus].label },
        { header: 'Official website', value: (b) => b.officialWebsite },
        { header: 'Opportunity score', value: (b) => b.opportunityScore },
        { header: 'Confidence %', value: (b) => b.confidenceScore },
        { header: 'Stage', value: (b) => STAGE_LABELS[b.stage] },
        { header: 'Contact permission', value: (b) => CONTACT_PERMISSION_META[b.contactPermission].label },
        { header: 'Next action', value: (b) => b.nextAction },
        { header: 'Next action due', value: (b) => b.nextActionDue },
        { header: 'Source URL', value: (b) => b.sourceUrl },
        { header: 'Updated', value: (b) => b.updatedAt },
        ...(includeContacts
          ? [
              { header: 'Enquiry channel', value: (b: Business) => b.enquiryChannel },
              { header: 'Business phone', value: (b: Business) => b.phone },
              { header: 'Business email', value: (b: Business) => b.email },
              { header: 'Contact source', value: (b: Business) => b.contactSource },
            ]
          : []),
      ]);
      await store.recordUsage({ provider: 'export', operation: 'csv_export', units: rows.length, estimatedCostUsd: 0, metadata: { scope, includeContacts } });
      download(`prospects-${todayIso()}.csv`, csv, 'text/csv;charset=utf-8');
      toast.success(`Exported ${rows.length} record${rows.length === 1 ? '' : 's'}`);
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title="Export prospects to CSV"
      description={`${businesses.length} stored record${businesses.length === 1 ? '' : 's'} (${scope}).`}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onClick={run} loading={pending} disabled={!businesses.length}>
            Download CSV
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Checkbox
          checked={includeContacts}
          onChange={(e) => setIncludeContacts(e.target.checked)}
          label="Include business contact details"
          description="Phone, email, enquiry channel and where they were published."
        />
        {includeContacts && (
          <Notice tone="warning" title="Handle contact details with care">
            Use exported contact details only for the purpose they were collected, store the file securely and delete it when no longer needed. Do not use it for bulk messaging.
          </Notice>
        )}
        <p className="text-xs text-subtle">Exports are recorded in the workspace usage log. Spreadsheet formulas in cell values are neutralised.</p>
      </div>
    </Dialog>
  );
}
