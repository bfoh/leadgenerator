'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Database, Download, RotateCcw, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import * as svc from '@/lib/data/services';
import { LocalStore } from '@/lib/data/local-store';
import { download, errorMessage } from '@/lib/utils';
import { useAction } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/field';
import { Notice } from '@/components/ui/misc';

export function DataTab() {
  const { workspace, store, settings, can } = useWorkspace();
  const qc = useQueryClient();
  const [exporting, setExporting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const importSeed = useAction(svc.importSeedResearch, { success: (n) => (n ? `Imported ${n} research records` : 'All research records are already present') });

  async function exportJson() {
    setExporting(true);
    try {
      const [businesses, verifications, activities, tasks, reports, proposals, projects, milestones] = await Promise.all([
        store.listBusinesses(),
        store.listVerifications(),
        store.listActivities(),
        store.listTasks(),
        store.listReports(),
        store.listProposals(),
        store.listProjects(),
        store.listMilestones(),
      ]);
      const payload = {
        exportedAt: new Date().toISOString(),
        organization: workspace.organizationName,
        mode: workspace.mode,
        settings,
        businesses,
        verifications,
        activities,
        tasks,
        reports,
        proposals,
        projects,
        milestones,
      };
      await store.recordUsage({ provider: 'export', operation: 'json_export', units: businesses.length, estimatedCostUsd: 0, metadata: { scope: 'workspace' } });
      download(`workspace-export-${payload.exportedAt.slice(0, 10)}.json`, JSON.stringify(payload, null, 2), 'application/json');
      setExportOpen(false);
      setAcknowledged(false);
      toast.success('Workspace exported');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setExporting(false);
    }
  }

  async function resetDemo() {
    if (!(store instanceof LocalStore)) return;
    store.reset();
    setResetOpen(false);
    await qc.invalidateQueries();
    toast.success('Demo workspace reset');
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader title="Earlier research records" description="The 20 businesses researched in v1–v3, with their documented website checks." />
        <CardBody className="space-y-3">
          <p className="text-sm text-muted">Records already present are skipped, so this is safe to run more than once. Imported records are rescored with the current settings.</p>
          <Button onClick={() => importSeed.run()} loading={importSeed.pending} disabled={!can('prospects.write')}>
            <Database className="size-4" aria-hidden /> Import research records
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Export workspace" description="Everything in this workspace as JSON: prospects, verifications, activity, tasks, reports, proposals and projects." />
        <CardBody className="space-y-3">
          <p className="text-sm text-muted">For backups or moving between demo and cloud. For filtered spreadsheets use Export on the Prospects page.</p>
          <Button onClick={() => setExportOpen(true)} disabled={!can('settings.manage')}>
            <Download className="size-4" aria-hidden /> Export JSON
          </Button>
          {!can('settings.manage') && <p className="text-xs text-subtle">Only owners and administrators can export the whole workspace.</p>}
        </CardBody>
      </Card>

      {workspace.mode === 'demo' && (
        <Card>
          <CardHeader title="Reset demo workspace" description="Deletes everything stored in this browser and starts again from the research records." />
          <CardBody>
            <Button variant="outline-danger" onClick={() => setResetOpen(true)} disabled={!can('settings.manage')}>
              <RotateCcw className="size-4" aria-hidden /> Reset demo
            </Button>
          </CardBody>
        </Card>
      )}

      <Notice tone="info" icon={ShieldCheck} title="Personal data">
        Contact names, numbers and emails are personal data under Ghana’s Data Protection Act, 2012 (Act 843). Export only what you need, store exports securely, and delete them when finished. See the{' '}
        <Link href="/privacy" className="font-medium underline underline-offset-2">
          privacy notice
        </Link>
        .
      </Notice>

      <Dialog
        open={exportOpen}
        onOpenChange={(o) => {
          setExportOpen(o);
          if (!o) setAcknowledged(false);
        }}
        title="Export workspace data"
        footer={
          <>
            <Button variant="ghost" onClick={() => setExportOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={exportJson} loading={exporting} disabled={!acknowledged}>
              Download JSON
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="text-muted">The file includes any contact details and permission evidence recorded on prospects. The export is logged.</p>
          <Checkbox label="I will store this file securely and use it only for the agency’s legitimate business purposes." checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
        </div>
      </Dialog>

      <Dialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        size="sm"
        title="Reset the demo workspace?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setResetOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={resetDemo}>
              Delete and reset
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">All prospects, reports, proposals, projects and settings in this browser are deleted. Export first if you want to keep them. This cannot be undone.</p>
      </Dialog>
    </div>
  );
}
