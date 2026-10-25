import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { createDatabase, createUser, as, rows } from './harness';

// Milestone 2 acceptance on an isolated, file-backed staging database. It follows the runbook in
// order: back up, inspect, apply 009, apply 010, run post-migration checks, create a campaign, attach
// prospects, queue research, close the "browser", confirm jobs/progress, confirm no paid or outbound
// side effects, then roll back a disposable copy. No network and no real Supabase project.

const OWNER = '00000000-0000-4000-8000-0000000000a1';
const root = () => mkdtempSync(join(tmpdir(), 'dof-staging-'));
const migration = (file: string) => readFileSync(join(process.cwd(), 'supabase', 'migrations', file), 'utf8');
const rollback = (file: string) => readFileSync(join(process.cwd(), 'supabase', 'rollback', file), 'utf8');
const check = (file: string) => readFileSync(join(process.cwd(), 'supabase', 'checks', file), 'utf8');

describe('staging acceptance for migrations 009 and 010', () => {
  it('backs up, migrates, runs a campaign, and rolls back a disposable copy', async () => {
    const dir = root();
    const live = join(dir, 'live');
    const backup = join(dir, 'backup');
    const disposable = join(dir, 'disposable');

    try {
      // 1. Baseline staging database (through 008) with one existing prospect.
      let db = await createDatabase({ dataDir: live, skip: ['009', '010', '011'] });
      await createUser(db, OWNER, 'owner@staging.example');
      const [{ org_id: org }] = await as(db, OWNER, () => rows<{ org_id: string }>(db, 'select * from public.ensure_workspace()'));
      const [existing] = await as(db, OWNER, () =>
        rows<{ id: string }>(
          db,
          `insert into public.businesses (organization_id, name, category, city, contact_permission, stage)
           values ($1, 'Kumasi Pharmacy', 'Pharmacy', 'Kumasi', 'unknown', 'research_candidate') returning id`,
          [org],
        ),
      );

      // 2. Back up the staging database before any milestone-2 migration.
      await db.close();
      cpSync(live, backup, { recursive: true });
      expect(existsSync(join(backup, 'PG_VERSION'))).toBe(true);

      // 3. Re-open and run the preflight (read only).
      db = new PGlite(live);
      const preflight = await db.query<{ check: string; value: string }>(check('preflight.sql'));
      expect(preflight.rows.find((row) => row.check.startsWith('002'))?.value).toBe('yes');
      expect(preflight.rows.find((row) => row.check.startsWith('009'))?.value).toBe('no');
      expect(preflight.rows.find((row) => row.check.startsWith('010'))?.value).toBe('no');
      expect(preflight.rows.find((row) => row.check === 'businesses')?.value).toBe('1');

      // 4–5. Apply 009, then 010.
      await db.exec(migration('009_research_campaigns.sql'));
      await db.exec(migration('010_region_records.sql'));

      // 6. Post-migration checks: every row must say ok.
      const after = await db.query<{ check: string; expected: string; actual: string; result: string }>(check('after-migrations.sql'));
      expect(after.rows.length).toBeGreaterThanOrEqual(33);
      // This staging copy is current except for 009-011: 011 discovery is the one later migration the
      // runbook still records as unapplied, so it is the only row that must report the gap.
      expect(after.rows.filter((row) => row.result !== 'ok').map((row) => row.check)).toEqual(['011 discovery tables installed']);
      expect((await rows<{ n: number }>(db, 'select count(*)::int as n from public.ghana_districts'))[0].n).toBe(261);

      // 7–8. Create an active campaign and attach two prospects, one known only to district level.
      const [campaignRow] = await as(db, OWNER, () =>
        rows<{ id: string }>(
          db,
          `insert into public.research_campaigns
             (organization_id, name, status, provider_key, regions, categories, batch_size, daily_target_limit, schedule_frequency, auto_complete)
           values ($1, 'Staging Kumasi pharmacies', 'active', 'tracked_records', '{Ashanti}', '{Pharmacy}', 10, 50, 'manual', true)
           returning id`,
          [org],
        ),
      );
      const [districtOnly] = await as(db, OWNER, () =>
        rows<{ id: string }>(
          db,
          `insert into public.businesses (organization_id, name, category, district_code, contact_permission, stage)
           values ($1, 'Obuasi Pharmacy', 'Pharmacy', 'GH0202', 'unknown', 'research_candidate') returning id`,
          [org],
        ),
      );
      const targetIds: string[] = [];
      for (const businessId of [existing.id, districtOnly.id]) {
        const [target] = await as(db, OWNER, () =>
          rows<{ id: string }>(
            db,
            `insert into public.campaign_targets (organization_id, campaign_id, business_id, match_reason)
             values ($1, $2, $3, 'Ashanti · Pharmacy') returning id`,
            [org, campaignRow.id, businessId],
          ),
        );
        targetIds.push(target.id);
      }

      // 9. Queue background research exactly as the orchestrator does, then close the database.
      for (const [index, targetId] of targetIds.entries()) {
        const businessId = index === 0 ? existing.id : districtOnly.id;
        await as(db, OWNER, () =>
          db.query(
            `select public.enqueue_campaign_job($1, 'business_identity', $2, '{}'::jsonb, $3, 200, null, null, false, 0, 3, $4, $5)`,
            [org, businessId, `staging:${campaignRow.id}:${businessId}`, campaignRow.id, targetId],
          ),
        );
        await as(db, OWNER, () => db.query(`update public.campaign_targets set state = 'researching' where id = $1`, [targetId]));
      }
      await db.close();

      // 10. Re-open after the browser is gone: the server-side worker finishes the queued jobs.
      db = new PGlite(live);
      await db.query(`update public.automation_jobs set status = 'succeeded', finished_at = now() where campaign_id = $1`, [campaignRow.id]);
      await db.query(`update public.campaign_targets set state = 'researched', note = 'Acceptance worker finished.' where campaign_id = $1`, [campaignRow.id]);
      await db.query(
        `insert into public.campaign_runs (organization_id, campaign_id, status, finished_at, targets_enqueued, targets_completed, jobs_open, spend_usd, note)
         values ($1, $2, 'succeeded', now(), 2, 2, 0, 0, 'Acceptance run')`,
        [org, campaignRow.id],
      );
      await db.query(
        `update public.research_campaigns set last_run_at = now(), last_run_status = 'succeeded', last_run_note = 'Acceptance run finished.' where id = $1`,
        [campaignRow.id],
      );

      // 11. Completed jobs, target states and campaign progress are visible.
      const jobs = await rows<{ status: string; campaign_target_id: string | null }>(
        db,
        'select status, campaign_target_id from public.automation_jobs where campaign_id = $1',
        [campaignRow.id],
      );
      expect(jobs).toHaveLength(2);
      expect(jobs.every((job) => job.status === 'succeeded' && job.campaign_target_id)).toBe(true);
      const targets = await rows<{ state: string }>(db, 'select state from public.campaign_targets where campaign_id = $1', [campaignRow.id]);
      expect(targets.map((target) => target.state)).toEqual(['researched', 'researched']);
      expect(
        (
          await rows<{ status: string; targets_completed: number }>(db, 'select status, targets_completed from public.campaign_runs where campaign_id = $1', [
            campaignRow.id,
          ])
        )[0],
      ).toMatchObject({ status: 'succeeded', targets_completed: 2 });
      const history = await rows<{ event: string }>(
        db,
        'select event from public.campaign_target_events where campaign_id = $1 order by created_at',
        [campaignRow.id],
      );
      expect(history.map((event) => event.event)).toEqual(['added', 'added', 'researching', 'researching', 'researched', 'researched']);

      // 12. No paid call, outbound message, agent run or recorded spend happened.
      expect((await rows<{ n: number }>(db, 'select count(*)::int as n from public.usage_records'))[0].n).toBe(0);
      expect((await rows<{ n: number }>(db, 'select count(*)::int as n from public.outreach_messages'))[0].n).toBe(0);
      expect((await rows<{ n: number }>(db, 'select count(*)::int as n from public.agent_runs'))[0].n).toBe(0);

      // 13. The backup still holds the pre-migration schema, and a disposable copy rolls back.
      const backupDb = new PGlite(backup);
      expect((await rows<{ t: string | null }>(backupDb, `select to_regclass('public.research_campaigns') as t`))[0].t).toBeNull();
      await backupDb.close();

      await db.close();
      cpSync(live, disposable, { recursive: true });
      const rollbackDb = new PGlite(disposable);
      await rollbackDb.query(`update public.businesses set city = 'Kumasi' where city is null`);
      await rollbackDb.exec(rollback('011_autonomous_discovery_down.sql'));
      await rollbackDb.exec(rollback('010_region_records_down.sql'));
      await rollbackDb.exec(rollback('009_research_campaigns_down.sql'));
      expect((await rows<{ t: string | null }>(rollbackDb, `select to_regclass('public.research_campaigns') as t`))[0].t).toBeNull();
      expect((await rows<{ t: string | null }>(rollbackDb, `select to_regclass('public.ghana_districts') as t`))[0].t).toBeNull();
      expect(
        (
          await rows<{ is_nullable: string }>(
            rollbackDb,
            `select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'businesses' and column_name = 'city'`,
          )
        )[0].is_nullable,
      ).toBe('NO');
      await rollbackDb.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 240_000);
});

