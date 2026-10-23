import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, as, asServiceRole, createDatabase, createUser, rows } from './harness';

// Exercises migration 003 (automation infrastructure) on PGlite: the policy guards, the job queue's
// functions and leases, row-level security, and the workflow triggers on businesses.

const OWNER = '00000000-0000-4000-8000-0000000000a1';
const RESEARCHER = '00000000-0000-4000-8000-0000000000a2';
const VIEWER = '00000000-0000-4000-8000-0000000000a3';
const OTHER = '00000000-0000-4000-8000-0000000000b1';

let db: PGlite;
let org: string;
let otherOrg: string;
let legacy: Record<string, string>;
let userCount = 0;

interface Job {
  id: string;
  organization_id: string;
  agent: string;
  status: string;
  attempts: number;
  lease_token: string | null;
  error_kind: string | null;
  last_error: string | null;
  cancel_requested: boolean;
  approved_by: string | null;
  finished_at: string | null;
  trace_id: string;
  parent_job_id: string | null;
}

async function workspace(user: string) {
  return as(db, user, async () => (await rows<{ org_id: string; member_role: string }>(db, 'select * from public.ensure_workspace()'))[0]);
}

/** A new user who owns a new, empty workspace (keeps queue tests independent of each other). */
async function freshOwner() {
  const id = `00000000-0000-4000-8000-${String(++userCount).padStart(12, '0')}`;
  await createUser(db, id, `owner${userCount}@example.com`);
  return { user: id, org: (await workspace(id)).org_id };
}

async function business(user: string, organization: string, values: Record<string, string> = {}) {
  const cols = ['organization_id', 'name', 'city', ...Object.keys(values)];
  const params = [organization, `Biz ${Math.random().toString(36).slice(2, 7)}`, 'Accra', ...Object.values(values)];
  const [row] = await as(db, user, () =>
    rows<{ id: string }>(db, `insert into public.businesses (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, params),
  );
  return row.id;
}

async function enqueue(
  user: string,
  organization: string,
  agent: string,
  options: { businessId?: string; key?: string; priority?: number; approval?: boolean; parent?: string; maxAttempts?: number } = {},
) {
  const [{ r }] = await as(db, user, () =>
    rows<{ r: { created: boolean; job: Job } }>(
      db,
      `select public.enqueue_automation_job(p_org => $1, p_agent => $2, p_business => $3, p_idempotency_key => $4, p_priority => $5,
         p_requires_approval => $6, p_parent => $7, p_max_attempts => $8) as r`,
      [organization, agent, options.businessId ?? null, options.key ?? null, options.priority ?? 100, options.approval ?? false, options.parent ?? null, options.maxAttempts ?? 3],
    ),
  );
  return r;
}

const claim = (user: string, organization: string | null, limit = 3) =>
  as(db, user, () => rows<Job>(db, `select * from public.claim_automation_jobs($1, 'test-worker', $2, 120)`, [organization, limit]));

async function finish(user: string, job: Job, outcome: string, extra: { error?: string; kind?: string; runAfter?: string } = {}) {
  const [row] = await as(db, user, () =>
    rows<Job>(db, `select * from public.finish_automation_job($1, $2, $3, null, $4, $5, $6)`, [job.id, job.lease_token, outcome, extra.error ?? null, extra.kind ?? null, extra.runAfter ?? null]),
  );
  return row;
}

const jobById = async (id: string) => (await rows<Job>(db, 'select * from public.automation_jobs where id = $1', [id]))[0];
const expireLease = (id: string) => db.query(`update public.automation_jobs set locked_until = now() - interval '1 second' where id = $1`, [id]);

beforeAll(async () => {
  db = await createDatabase({
    // An existing workspace with records from before automation was installed.
    before003: async (d) => {
      await createUser(d, OWNER, 'owner@example.com');
      const [{ org_id }] = await as(d, OWNER, () => rows<{ org_id: string }>(d, 'select * from public.ensure_workspace()'));
      const insert = (name: string, extra: string) =>
        as(d, OWNER, async () => {
          const [row] = await rows<{ id: string }>(d, `insert into public.businesses (organization_id, name, city${extra ? ', ' + extra.split('=')[0] : ''}) values ($1, $2, 'Kumasi'${extra ? `, '${extra.split('=')[1]}'` : ''}) returning id`, [org_id, name]);
          return row.id;
        });
      legacy = {
        fresh: await insert('Fresh Co', ''),
        won: await insert('Won Co', 'stage=won'),
        pending: await insert('Pending Co', 'stage=verification_pending'),
        optedOut: await insert('Opted Out Co', 'contact_permission=opted_out'),
      };
      // Backdate one record without the touch and audit triggers, as if it was last edited in January.
      await d.exec('alter table public.businesses disable trigger businesses_touch; alter table public.businesses disable trigger businesses_audit;');
      await d.query(`update public.businesses set updated_at = '2026-01-02T03:04:05Z' where id = $1`, [legacy.won]);
      await d.exec('alter table public.businesses enable trigger businesses_touch; alter table public.businesses enable trigger businesses_audit;');
    },
  });
  org = (await workspace(OWNER)).org_id;
  await createUser(db, RESEARCHER, 'researcher@example.com');
  await createUser(db, VIEWER, 'viewer@example.com');
  await createUser(db, OTHER, 'other@example.com');
  await as(db, OWNER, () =>
    db.query(`insert into public.organization_invitations (organization_id, email, role) values ($1, 'researcher@example.com', 'researcher'), ($1, 'viewer@example.com', 'viewer')`, [org]),
  );
  expect((await workspace(RESEARCHER)).member_role).toBe('researcher');
  expect((await workspace(VIEWER)).member_role).toBe('viewer');
  otherOrg = (await workspace(OTHER)).org_id;
});

describe('workflow state backfill', () => {
  it('derives the state of existing records once, without touching updated_at or the audit log', async () => {
    const states = await rows<{ id: string; workflow_state: string; workflow_state_at: string; updated_at: string; workflow_state_reason: string }>(
      db,
      'select id, workflow_state, workflow_state_at, updated_at, workflow_state_reason from public.businesses where organization_id = $1',
      [org],
    );
    const byId = Object.fromEntries(states.map((s) => [s.id, s]));
    expect(byId[legacy.fresh].workflow_state).toBe('discovered');
    expect(byId[legacy.won].workflow_state).toBe('client_won');
    expect(byId[legacy.pending].workflow_state).toBe('website_verification');
    expect(byId[legacy.optedOut].workflow_state).toBe('opted_out');
    expect(new Date(byId[legacy.won].updated_at).toISOString()).toBe('2026-01-02T03:04:05.000Z');
    expect(new Date(byId[legacy.won].workflow_state_at).toISOString()).toBe('2026-01-02T03:04:05.000Z');
    expect(byId[legacy.won].workflow_state_reason).toMatch(/Derived from the CRM stage/);
    const updates = await rows(db, `select 1 from public.audit_events where table_name = 'businesses' and action = 'update' and organization_id = $1`, [org]);
    expect(updates).toHaveLength(0);
  });

  it('creates default automation settings for workspaces that existed before the migration', async () => {
    const [s] = await rows<Record<string, unknown>>(db, 'select * from public.automation_settings where organization_id = $1', [org]);
    expect(s).toMatchObject({ mode: 'research_only', paused: false, outbound_stopped: true, max_concurrent_jobs: 2, disabled_agents: [], budgets: {} });
  });

  it('is re-runnable and does not repeat the backfill or reset settings', async () => {
    await as(db, OWNER, () => db.query(`update public.automation_settings set mode = 'research_and_proposals' where organization_id = $1`, [org]));
    await as(db, OWNER, () => db.query(`update public.businesses set stage = 'qualified' where id = $1`, [legacy.fresh]));
    const before = (await rows<{ workflow_state: string }>(db, 'select workflow_state from public.businesses where id = $1', [legacy.fresh]))[0].workflow_state;
    await db.exec(readFileSync(join(MIGRATIONS_DIR, '003_automation_infrastructure.sql'), 'utf8'));
    const after = (await rows<{ workflow_state: string }>(db, 'select workflow_state from public.businesses where id = $1', [legacy.fresh]))[0].workflow_state;
    expect(after).toBe(before);
    expect((await rows<{ mode: string }>(db, 'select mode from public.automation_settings where organization_id = $1', [org]))[0].mode).toBe('research_and_proposals');
    await as(db, OWNER, () => db.query(`update public.automation_settings set mode = 'research_only' where organization_id = $1`, [org]));
  });
});

describe('workflow triggers', () => {
  it('derives the starting state of new records and logs the transition', async () => {
    const id = await business(OWNER, org, { stage: 'qualified' });
    const [b] = await rows<{ workflow_state: string; workflow_state_actor: string }>(db, 'select workflow_state, workflow_state_actor from public.businesses where id = $1', [id]);
    expect(b.workflow_state).toBe('qualification');
    const log = await as(db, OWNER, () => rows<{ from_state: string | null; to_state: string; actor_id: string }>(db, 'select from_state, to_state, actor_id from public.workflow_transitions where business_id = $1', [id]));
    expect(log).toEqual([{ from_state: null, to_state: 'qualification', actor_id: OWNER }]);
  });

  it('forces opted_out when an opt-out is recorded and keeps it there', async () => {
    const id = await business(OWNER, org);
    await as(db, OWNER, () => db.query(`update public.businesses set contact_permission = 'opted_out' where id = $1`, [id]));
    // An agent or user cannot move an opted-out prospect back into the workflow.
    await as(db, OWNER, () => db.query(`update public.businesses set workflow_state = 'qualification', workflow_state_actor = 'agent' where id = $1`, [id]));
    const [b] = await rows<{ workflow_state: string; workflow_state_actor: string; workflow_state_reason: string }>(db, 'select workflow_state, workflow_state_actor, workflow_state_reason from public.businesses where id = $1', [id]);
    expect(b).toEqual({ workflow_state: 'opted_out', workflow_state_actor: 'system', workflow_state_reason: 'Opt-out recorded: contact and automation stopped' });
    const log = await rows<{ to_state: string; actor_type: string }>(db, 'select to_state, actor_type from public.workflow_transitions where business_id = $1 order by id', [id]);
    expect(log.map((l) => l.to_state)).toEqual(['discovered', 'opted_out']);
    expect(log[1].actor_type).toBe('system');
  });

  it('mirrors closing CRM stages into the workflow, attributed to the member', async () => {
    const id = await business(OWNER, org);
    await as(db, OWNER, () => db.query(`update public.businesses set stage = 'discovery_meeting' where id = $1`, [id]));
    await as(db, OWNER, () => db.query(`update public.businesses set stage = 'lost', interest_level = 'none' where id = $1`, [id]));
    const log = await rows<{ to_state: string; actor_type: string; actor_id: string }>(db, 'select to_state, actor_type, actor_id from public.workflow_transitions where business_id = $1 order by id', [id]);
    expect(log.map((l) => l.to_state)).toEqual(['discovered', 'meeting', 'not_interested']);
    expect(log[2]).toMatchObject({ actor_type: 'user', actor_id: OWNER });
  });

  it('does not log anything when an update leaves the state alone', async () => {
    const id = await business(OWNER, org);
    await as(db, OWNER, () => db.query(`update public.businesses set notes = 'still researching' where id = $1`, [id]));
    expect(await rows(db, 'select 1 from public.workflow_transitions where business_id = $1', [id])).toHaveLength(1);
  });

  it('rejects unknown states and keeps the log read-only for clients', async () => {
    const id = await business(OWNER, org);
    await expect(as(db, OWNER, () => db.query(`update public.businesses set workflow_state = 'sent_everything' where id = $1`, [id]))).rejects.toThrow(/businesses_workflow_state_check/);
    await expect(
      as(db, OWNER, () => db.query(`insert into public.workflow_transitions (organization_id, business_id, to_state, actor_type) values ($1, $2, 'client_won', 'user')`, [org, id])),
    ).rejects.toThrow(/permission denied/);
    expect(await as(db, OTHER, () => rows(db, 'select 1 from public.workflow_transitions where business_id = $1', [id]))).toHaveLength(0);
  });
});

describe('automation settings', () => {
  it('starts every new workspace in research-only mode with the outbound stop engaged', async () => {
    const [s] = await as(db, OTHER, () => rows<Record<string, unknown>>(db, 'select mode, paused, outbound_stopped from public.automation_settings'));
    expect(s).toEqual({ mode: 'research_only', paused: false, outbound_stopped: true });
  });

  it('never lets the emergency stop be lifted in this version', async () => {
    await expect(
      as(db, OWNER, () => db.query(`update public.automation_settings set outbound_stopped = false, outbound_stop_reason = 'testing' where organization_id = $1`, [org])),
    ).rejects.toThrow(/emergency stop stays engaged/);
  });

  it('rejects outreach modes and unknown budget providers', async () => {
    for (const mode of ['approval_based_outreach', 'eligible_automated_outreach']) {
      await expect(as(db, OWNER, () => db.query(`update public.automation_settings set mode = $2 where organization_id = $1`, [org, mode]))).rejects.toThrow(/Outreach modes are not available/);
    }
    await expect(
      as(db, OWNER, () => db.query(`update public.automation_settings set budgets = '{"openai": {"dailyUsd": 1}}' where organization_id = $1`, [org])),
    ).rejects.toThrow(/known providers/);
  });

  it('lets owners change policy, records who did it, and audits the change', async () => {
    await as(db, OWNER, () =>
      db.query(`update public.automation_settings set paused = true, budgets = '{"anthropic": {"dailyUsd": 1, "monthlyUsd": 10}}' where organization_id = $1`, [org]),
    );
    const [s] = await rows<{ paused: boolean; updated_by: string }>(db, 'select paused, updated_by from public.automation_settings where organization_id = $1', [org]);
    expect(s).toEqual({ paused: true, updated_by: OWNER });
    const audit = await rows<{ changes: Record<string, unknown> }>(db, `select changes from public.audit_events where table_name = 'automation_settings' and action = 'update' and organization_id = $1 order by id desc limit 1`, [org]);
    expect(Object.keys(audit[0].changes)).toEqual(expect.arrayContaining(['paused', 'budgets']));
    await as(db, OWNER, () => db.query(`update public.automation_settings set paused = false, budgets = '{}' where organization_id = $1`, [org]));
  });

  it('is read-only for researchers, viewers and other workspaces', async () => {
    for (const user of [RESEARCHER, VIEWER, OTHER]) {
      const res = await as(db, user, () => db.query(`update public.automation_settings set paused = true where organization_id = $1`, [org]));
      expect(res.affectedRows ?? 0).toBe(0);
    }
    expect(await as(db, VIEWER, () => rows(db, 'select 1 from public.automation_settings'))).toHaveLength(1);
    await expect(as(db, null, () => db.query('select * from public.automation_settings'))).rejects.toThrow(/permission denied/);
  });

  it('cancels queued outbound work when the stop is engaged (simulated future version)', async () => {
    await db.exec('begin');
    try {
      await db.exec(`create or replace function public.outbound_available() returns boolean language sql stable set search_path = '' as $$ select true $$`);
      await as(db, OWNER, () =>
        db.query(`update public.automation_settings set outbound_stopped = false, outbound_stop_reason = 'Checklist complete' where organization_id = $1`, [org]),
      );
      const queued = await enqueue(OWNER, org, 'outreach_execution', { approval: true });
      expect(queued.job.status).toBe('awaiting_approval');
      await as(db, OWNER, () => db.query(`update public.automation_settings set outbound_stopped = true, outbound_stop_reason = 'Complaint received' where organization_id = $1`, [org]));
      const job = await jobById(queued.job.id);
      expect(job.status).toBe('cancelled');
      expect(job.last_error).toMatch(/emergency stop/);
    } finally {
      await db.exec('rollback');
    }
    expect((await rows<{ outbound_stopped: boolean }>(db, 'select outbound_stopped from public.automation_settings where organization_id = $1', [org]))[0].outbound_stopped).toBe(true);
  });
});

describe('enqueueing jobs', () => {
  it('is idempotent per workspace and key', async () => {
    const id = await business(OWNER, org);
    const first = await enqueue(OWNER, org, 'opportunity_scoring', { businessId: id, key: 'score:1' });
    const second = await enqueue(RESEARCHER, org, 'opportunity_scoring', { businessId: id, key: 'score:1' });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
    expect(first.job).toMatchObject({ status: 'pending', attempts: 0 });
    // The same key in another workspace is a different job.
    const elsewhere = await enqueue(OTHER, otherOrg, 'opportunity_scoring', { key: 'score:1' });
    expect(elsewhere.created).toBe(true);
  });

  it('keeps follow-up jobs in the parent’s trace', async () => {
    const parent = await enqueue(OWNER, org, 'opportunity_scoring');
    const child = await enqueue(OWNER, org, 'opportunity_report', { parent: parent.job.id });
    expect(child.job.trace_id).toBe(parent.job.trace_id);
    expect(child.job.parent_job_id).toBe(parent.job.id);
    await expect(enqueue(OTHER, otherOrg, 'opportunity_report', { parent: parent.job.id })).rejects.toThrow(/Parent job not found/);
  });

  it('refuses viewers, outsiders, foreign prospects and outbound sends', async () => {
    const id = await business(OWNER, org);
    await expect(enqueue(VIEWER, org, 'opportunity_scoring')).rejects.toThrow(/does not allow automation/);
    await expect(enqueue(OTHER, org, 'opportunity_scoring')).rejects.toThrow(/does not allow automation/);
    await expect(enqueue(OTHER, otherOrg, 'opportunity_scoring', { businessId: id })).rejects.toThrow(/does not exist in this workspace/);
    await expect(enqueue(OWNER, org, 'outreach_execution')).rejects.toThrow(/Outbound sending is stopped/);
    await expect(enqueue(OWNER, org, 'send_everything')).rejects.toThrow(/automation_jobs_agent_check/);
  });

  it('only changes jobs through the queue functions', async () => {
    const { job } = await enqueue(OWNER, org, 'opportunity_scoring');
    await expect(as(db, OWNER, () => db.query(`update public.automation_jobs set status = 'succeeded' where id = $1`, [job.id]))).rejects.toThrow(/permission denied/);
    await expect(as(db, OWNER, () => db.query(`delete from public.automation_jobs where id = $1`, [job.id]))).rejects.toThrow(/permission denied/);
    await expect(
      as(db, OWNER, () => db.query(`insert into public.automation_jobs (organization_id, agent) values ($1, 'opportunity_scoring')`, [org])),
    ).rejects.toThrow(/permission denied/);
    await expect(as(db, null, () => db.query(`select public.enqueue_automation_job($1, 'opportunity_scoring')`, [org]))).rejects.toThrow(/permission denied/);
    expect(await as(db, OTHER, () => rows(db, 'select 1 from public.automation_jobs where id = $1', [job.id]))).toHaveLength(0);
  });
});

describe('claiming and finishing jobs', () => {
  it('claims by priority, up to the concurrency limit, with a lease', async () => {
    const { user, org: o } = await freshOwner();
    const low = await enqueue(user, o, 'opportunity_scoring', { priority: 200 });
    const high = await enqueue(user, o, 'opportunity_scoring', { priority: 10 });
    await enqueue(user, o, 'opportunity_scoring', { priority: 100 });
    await as(db, user, () => db.query('update public.automation_settings set max_concurrent_jobs = 1 where organization_id = $1', [o]));
    const [first, ...rest] = await claim(user, o, 3);
    expect(rest).toHaveLength(0);
    expect(first.id).toBe(high.job.id);
    expect(first).toMatchObject({ status: 'running', attempts: 1 });
    expect(first.lease_token).toBeTruthy();
    expect(await claim(user, o, 3)).toHaveLength(0); // the only slot is taken
    await finish(user, first, 'succeeded');
    const [next] = await claim(user, o, 3);
    expect(next.id).not.toBe(low.job.id); // priority 100 before 200
  });

  it('claims nothing while paused or for disabled agents', async () => {
    const { user, org: o } = await freshOwner();
    await enqueue(user, o, 'opportunity_report');
    await as(db, user, () => db.query('update public.automation_settings set paused = true where organization_id = $1', [o]));
    expect(await claim(user, o)).toHaveLength(0);
    await as(db, user, () => db.query(`update public.automation_settings set paused = false, disabled_agents = '{opportunity_report}' where organization_id = $1`, [o]));
    expect(await claim(user, o)).toHaveLength(0);
    await as(db, user, () => db.query(`update public.automation_settings set disabled_agents = '{}' where organization_id = $1`, [o]));
    expect(await claim(user, o)).toHaveLength(1);
  });

  it('retries with backoff, then dead-letters after the last attempt', async () => {
    const { user, org: o } = await freshOwner();
    await enqueue(user, o, 'opportunity_scoring', { maxAttempts: 2 });
    let [job] = await claim(user, o);
    const later = new Date(Date.now() + 60_000).toISOString();
    const retried = await finish(user, job, 'retry', { error: 'Provider timed out', kind: 'retryable', runAfter: later });
    expect(retried).toMatchObject({ status: 'pending', attempts: 1, lease_token: null, error_kind: 'retryable' });
    expect(await claim(user, o)).toHaveLength(0); // not due yet
    await db.query('update public.automation_jobs set run_after = now() where id = $1', [job.id]);
    [job] = await claim(user, o);
    expect(job.attempts).toBe(2);
    const dead = await finish(user, job, 'retry', { error: 'Provider timed out again', kind: 'retryable' });
    expect(dead).toMatchObject({ status: 'failed', attempts: 2, error_kind: 'retryable' });
    expect(dead.finished_at).toBeTruthy();
  });

  it('does not retry permanent errors and does not count deferrals as attempts', async () => {
    const { user, org: o } = await freshOwner();
    await enqueue(user, o, 'opportunity_scoring');
    let [job] = await claim(user, o);
    const deferred = await finish(user, job, 'deferred', { error: 'Daily budget reached', kind: 'budget', runAfter: new Date(Date.now() - 1000).toISOString() });
    expect(deferred).toMatchObject({ status: 'pending', attempts: 0, error_kind: 'budget' });
    [job] = await claim(user, o);
    const failed = await finish(user, job, 'retry', { error: 'Bad input', kind: 'permanent' });
    expect(failed.status).toBe('failed');
  });

  it('rejects a finish from a worker whose lease is gone', async () => {
    const { user, org: o } = await freshOwner();
    await enqueue(user, o, 'opportunity_scoring');
    const [job] = await claim(user, o);
    await expect(finish(user, { ...job, lease_token: '00000000-0000-4000-8000-000000000000' }, 'succeeded')).rejects.toThrow(/no longer held/);
    await finish(user, job, 'succeeded');
    await expect(finish(user, job, 'succeeded')).rejects.toThrow(/no longer held/);
    await expect(finish(VIEWER, job, 'succeeded')).rejects.toThrow(/does not allow automation/);
  });

  it('recovers expired leases: research work is retried, outbound work fails as uncertain', async () => {
    const { user, org: o } = await freshOwner();
    const research = await enqueue(user, o, 'opportunity_scoring');
    // Outbound jobs cannot be queued in this version; insert one directly to test the recovery rule.
    const [outbound] = await rows<{ id: string }>(
      db,
      `insert into public.automation_jobs (organization_id, agent, status, attempts, lease_token, locked_until, worker, started_at)
       values ($1, 'outreach_execution', 'running', 1, gen_random_uuid(), now() - interval '1 minute', 'gone', now()) returning id`,
      [o],
    );
    const [job] = await claim(user, o);
    expect(job.id).toBe(research.job.id);
    await expireLease(job.id);
    const [again] = await claim(user, o);
    expect(again).toMatchObject({ id: job.id, status: 'running', attempts: 2 });
    const lost = await jobById(outbound.id);
    expect(lost).toMatchObject({ status: 'failed', error_kind: 'uncertain_delivery', lease_token: null });
    expect(lost.last_error).toMatch(/will not be retried automatically/);
    await expect(as(db, user, () => db.query('select public.retry_automation_job($1)', [outbound.id]))).rejects.toThrow(/never re-sent/);
  });

  it('cancels queued jobs at once and running jobs at their next checkpoint', async () => {
    const { user, org: o } = await freshOwner();
    const queued = await enqueue(user, o, 'opportunity_scoring', { priority: 500 });
    const running = await enqueue(user, o, 'opportunity_scoring', { priority: 1 });
    const [job] = await claim(user, o, 1);
    expect(job.id).toBe(running.job.id);
    await as(db, user, () => db.query('select public.cancel_automation_job($1, $2)', [queued.job.id, 'Not needed']));
    expect(await jobById(queued.job.id)).toMatchObject({ status: 'cancelled', error_kind: 'cancelled', last_error: 'Not needed' });
    await as(db, user, () => db.query('select public.cancel_automation_job($1)', [job.id]));
    expect((await jobById(job.id)).cancel_requested).toBe(true);
    const done = await finish(user, job, 'retry', { error: 'stopping', kind: 'retryable' });
    expect(done.status).toBe('cancelled');
    await expect(as(db, user, () => db.query('select public.cancel_automation_job($1)', [job.id]))).rejects.toThrow(/Only queued or running/);
    // A cancelled research job can be retried from the start.
    await as(db, user, () => db.query('select public.retry_automation_job($1)', [job.id]));
    expect(await jobById(job.id)).toMatchObject({ status: 'pending', attempts: 0, cancel_requested: false, error_kind: null });
  });

  it('requires an owner or admin to approve a step', async () => {
    const id = await business(OWNER, org);
    const { job } = await enqueue(RESEARCHER, org, 'opportunity_report', { businessId: id, approval: true });
    expect(job.status).toBe('awaiting_approval');
    await expect(as(db, RESEARCHER, () => db.query('select public.approve_automation_job($1)', [job.id]))).rejects.toThrow(/Only owners and administrators/);
    await as(db, OWNER, () => db.query('select public.approve_automation_job($1)', [job.id]));
    expect(await jobById(job.id)).toMatchObject({ status: 'pending', approved_by: OWNER });
    await expect(as(db, OWNER, () => db.query('select public.approve_automation_job($1)', [job.id]))).rejects.toThrow(/not waiting for approval/);
    await as(db, OWNER, () => db.query('select public.cancel_automation_job($1)', [job.id]));
  });

  it('lets only the service role claim across workspaces', async () => {
    const a = await freshOwner();
    const b = await freshOwner();
    const ja = await enqueue(a.user, a.org, 'opportunity_scoring', { priority: 0 });
    const jb = await enqueue(b.user, b.org, 'opportunity_scoring', { priority: 0 });
    await expect(claim(a.user, null)).rejects.toThrow(/Only the background worker/);
    await expect(claim(a.user, b.org)).rejects.toThrow(/does not allow automation/);
    const claimed = await asServiceRole(db, () => rows<Job>(db, `select * from public.claim_automation_jobs(null, 'cron', 20, 120)`));
    expect(claimed.map((j) => j.id)).toEqual(expect.arrayContaining([ja.job.id, jb.job.id]));
    const mine = claimed.find((j) => j.id === ja.job.id)!;
    const [done] = await asServiceRole(db, () => rows<Job>(db, `select * from public.finish_automation_job($1, $2, 'succeeded')`, [mine.id, mine.lease_token]));
    expect(done.status).toBe('succeeded');
  });
});

describe('agent run log', () => {
  it('is append-only and attributed to the member who ran the agent', async () => {
    const insert = (user: string, organization: string, actor: string | null) =>
      as(db, user, () =>
        db.query(
          `insert into public.agent_runs (organization_id, agent, agent_version, status, summary, started_at, finished_at, actor_id)
           values ($1, 'opportunity_scoring', 'scoring-1.0.0', 'succeeded', 'Scored 72/100', now(), now(), $2)`,
          [organization, actor],
        ),
      );
    await insert(RESEARCHER, org, RESEARCHER);
    await expect(insert(RESEARCHER, org, OWNER)).rejects.toThrow(/row-level security/);
    await expect(insert(VIEWER, org, VIEWER)).rejects.toThrow(/row-level security/);
    await expect(insert(OTHER, org, OTHER)).rejects.toThrow(/row-level security/);
    await expect(as(db, OWNER, () => db.query(`update public.agent_runs set summary = 'edited'`))).rejects.toThrow(/permission denied/);
    await expect(as(db, OWNER, () => db.query('delete from public.agent_runs'))).rejects.toThrow(/permission denied/);
    expect(await as(db, VIEWER, () => rows(db, 'select 1 from public.agent_runs'))).toHaveLength(1);
    expect(await as(db, OTHER, () => rows(db, 'select 1 from public.agent_runs'))).toHaveLength(0);
  });
});

describe('rollback', () => {
  it('removes migration 003 cleanly, keeps businesses, and can be re-applied', async () => {
    const fresh = await createDatabase();
    await createUser(fresh, OWNER, 'owner@example.com');
    const [{ org_id }] = await as(fresh, OWNER, () => rows<{ org_id: string }>(fresh, 'select * from public.ensure_workspace()'));
    await as(fresh, OWNER, () => fresh.query(`insert into public.businesses (organization_id, name, city, stage) values ($1, 'Keep Me', 'Accra', 'qualified')`, [org_id]));

    await fresh.exec(readFileSync(join(process.cwd(), 'supabase', 'rollback', '003_automation_infrastructure_down.sql'), 'utf8'));
    const leftovers = await rows(
      fresh,
      `select table_name from information_schema.tables where table_schema = 'public' and table_name in ('automation_jobs', 'automation_settings', 'agent_runs', 'workflow_transitions')
       union all select column_name from information_schema.columns where table_schema = 'public' and table_name = 'businesses' and column_name like 'workflow_state%'
       union all select proname from pg_proc where pronamespace = 'public'::regnamespace and proname in ('enqueue_automation_job', 'claim_automation_jobs', 'sync_workflow_state', 'can_automate')`,
    );
    expect(leftovers).toEqual([]);
    // The pre-003 app keeps working.
    await as(fresh, OWNER, () => fresh.query(`update public.businesses set stage = 'won' where organization_id = $1`, [org_id]));

    await fresh.exec(readFileSync(join(MIGRATIONS_DIR, '003_automation_infrastructure.sql'), 'utf8'));
    const [b] = await rows<{ workflow_state: string }>(fresh, 'select workflow_state from public.businesses where organization_id = $1', [org_id]);
    expect(b.workflow_state).toBe('client_won');
    expect(await rows(fresh, 'select 1 from public.automation_settings where organization_id = $1', [org_id])).toHaveLength(1);
    await fresh.close();
  });
});
