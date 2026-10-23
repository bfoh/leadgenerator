import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, asServiceRole, createDatabase, createUser, rows } from './harness';

// Job reliability soak on the database queue (migration 003's claim / finish / cancel functions),
// the same scenario as tests/unit/job-reliability.test.ts for the demo store. Two workspaces share
// the queue; the scheduled worker (service role, every workspace) and a signed-in owner (one
// workspace) claim, finish, crash and retry with stale leases in a seeded random order. Time moves by
// shifting the queue's timestamps back, since now() cannot be faked inside Postgres.

const OWNER_A = '00000000-0000-4000-8000-00000000c0a1';
const OWNER_B = '00000000-0000-4000-8000-00000000c0b1';
const CONCURRENCY = 3;
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);

interface Job {
  id: string;
  organization_id: string;
  status: string;
  attempts: number;
  max_attempts: number;
  lease_token: string | null;
  finished_at: string | null;
}

let db: PGlite;
let orgA: string;
let orgB: string;

function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

beforeAll(async () => {
  db = await createDatabase();
  await createUser(db, OWNER_A, 'a@example.com');
  await createUser(db, OWNER_B, 'b@example.com');
  orgA = (await as(db, OWNER_A, () => rows<{ org_id: string }>(db, 'select * from public.ensure_workspace()')))[0].org_id;
  orgB = (await as(db, OWNER_B, () => rows<{ org_id: string }>(db, 'select * from public.ensure_workspace()')))[0].org_id;
  for (const [user, org] of [
    [OWNER_A, orgA],
    [OWNER_B, orgB],
  ] as const) {
    await as(db, user, () => db.query('update public.automation_settings set max_concurrent_jobs = $2 where organization_id = $1', [org, CONCURRENCY]));
  }
});

type Actor = { kind: 'worker' } | { kind: 'owner'; user: string; org: string };

const run = <T,>(actor: Actor, fn: () => Promise<T>) => (actor.kind === 'worker' ? asServiceRole(db, fn) : as(db, actor.user, fn));

async function soak(seed: number) {
  const rnd = prng(seed);
  const pick = <T,>(list: readonly T[]) => list[Math.floor(rnd() * list.length)];
  await db.query('delete from public.automation_jobs');
  for (const [user, org] of [
    [OWNER_A, orgA],
    [OWNER_B, orgB],
  ] as const) {
    for (let i = 0; i < 12; i++) {
      await as(db, user, () =>
        db.query(`select public.enqueue_automation_job(p_org => $1, p_agent => 'opportunity_scoring', p_idempotency_key => $2, p_max_attempts => $3)`, [org, `soak-${seed}-${i}`, 1 + Math.floor(rnd() * 4)]),
      );
    }
  }
  const actors: Record<string, Actor> = { cron: { kind: 'worker' }, ownerA: { kind: 'owner', user: OWNER_A, org: orgA } };
  const held = new Map<string, Job[]>(Object.keys(actors).map((k) => [k, []]));
  const successes = new Map<string, number>();
  const terminalSeen = new Map<string, string>();
  let staleRejected = 0;
  let crossTenantRejected = 0;

  const all =() => rows<Job>(db, 'select id, organization_id, status, attempts, max_attempts, lease_token, finished_at from public.automation_jobs');
  const check = async () => {
    const jobs = await all();
    for (const org of [orgA, orgB]) expect(jobs.filter((j) => j.organization_id === org && j.status === 'running').length).toBeLessThanOrEqual(CONCURRENCY);
    for (const j of jobs) {
      expect(j.attempts).toBeLessThanOrEqual(j.max_attempts);
      expect(successes.get(j.id) ?? 0).toBeLessThanOrEqual(1);
      if (TERMINAL.has(j.status)) {
        expect(j.finished_at).not.toBeNull();
        expect(j.lease_token).toBeNull();
        if (terminalSeen.has(j.id)) expect(j.status).toBe(terminalSeen.get(j.id));
        terminalSeen.set(j.id, j.status);
      } else {
        expect(j.finished_at).toBeNull();
      }
    }
  };

  const finish = async (name: string, job: Job, outcome: string, kind: string | null = null) => {
    held.set(name, held.get(name)!.filter((h) => h !== job));
    const [current] = await rows<Job>(db, 'select status, lease_token from public.automation_jobs where id = $1', [job.id]);
    const valid = current.status === 'running' && current.lease_token === job.lease_token;
    try {
      const [after] = await run(actors[name], () => rows<Job>(db, 'select * from public.finish_automation_job($1, $2, $3, null, $4, $5)', [job.id, job.lease_token, outcome, outcome === 'succeeded' ? null : 'soak', kind]));
      expect(valid).toBe(true);
      if (after.status === 'succeeded') successes.set(job.id, (successes.get(job.id) ?? 0) + 1);
    } catch (error) {
      const actor = actors[name];
      if (actor.kind === 'owner' && job.organization_id !== actor.org) {
        // A copy of another workspace's job: refused before the lease is even looked at.
        expect(String(error)).toMatch(/does not allow automation/);
        crossTenantRejected++;
        return;
      }
      expect(String(error)).toMatch(/no longer held by this worker/);
      expect(valid).toBe(false);
      staleRejected++;
    }
  };

  const claim = async (name: string, limit: number) => {
    const actor = actors[name];
    const claimed = await run(actor, () => rows<Job>(db, `select * from public.claim_automation_jobs($1, $2, $3, 60)`, [actor.kind === 'owner' ? actor.org : null, name, limit]));
    for (const j of claimed) {
      expect(terminalSeen.has(j.id)).toBe(false);
      if (actor.kind === 'owner') expect(j.organization_id).toBe(actor.org);
    }
    held.get(name)!.push(...claimed);
    return claimed;
  };

  /** Moves time forward by shifting every timestamp the queue compares with now(). */
  const advance = (seconds: number) =>
    db.query(`update public.automation_jobs set run_after = run_after - make_interval(secs => $1), locked_until = locked_until - make_interval(secs => $1)`, [seconds]);

  for (let step = 0; step < 250; step++) {
    const roll = rnd();
    const name = pick(Object.keys(actors));
    const mine = held.get(name)!;
    if (roll < 0.3) await claim(name, 1 + Math.floor(rnd() * 3));
    else if (roll < 0.62 && mine.length) {
      const job = pick(mine);
      const outcome = rnd();
      if (outcome < 0.5) await finish(name, job, 'succeeded');
      else if (outcome < 0.75) await finish(name, job, 'retry', 'retryable');
      else if (outcome < 0.82) await finish(name, job, 'retry', 'permanent');
      else if (outcome < 0.94) await finish(name, job, 'deferred', 'budget');
      else await finish(name, job, 'failed', 'permanent');
    } else if (roll < 0.7 && mine.length) {
      // A crash: the job is forgotten, and a stale copy may be finished later by someone else.
      held.get(pick(Object.keys(actors)))!.push(mine.shift()!);
    } else if (roll < 0.74) {
      const open = (await all()).filter((j) => j.organization_id === orgA && (j.status === 'pending' || j.status === 'running'));
      if (open.length) await as(db, OWNER_A, () => db.query('select public.cancel_automation_job($1, $2)', [pick(open).id, 'Soak test cancellation']));
    } else {
      await advance(Math.floor(rnd() * 90));
    }
    await check();
  }

  for (const k of held.keys()) held.set(k, []);
  for (let round = 0; round < 200; round++) {
    await advance(15 * 60);
    const claimed = await claim('cron', 20);
    if (!claimed.length && !(await all()).some((j) => !TERMINAL.has(j.status))) break;
    for (const job of claimed) await finish('cron', job, rnd() < 0.7 ? 'succeeded' : 'retry', rnd() < 0.7 ? null : 'retryable');
    await check();
  }
  const jobs = await all();
  expect(jobs.filter((j) => !TERMINAL.has(j.status))).toEqual([]);
  return { jobs, staleRejected, crossTenantRejected };
}

describe('job queue reliability (database)', () => {
  for (const seed of [3, 99]) {
    it(`keeps its guarantees across workers, workspaces, crashes and stale leases (seed ${seed})`, async () => {
      const { jobs, staleRejected } = await soak(seed);
      expect(jobs).toHaveLength(24);
      expect(staleRejected).toBeGreaterThan(0);
      expect(jobs.some((j) => j.status === 'succeeded')).toBe(true);
      expect(jobs.some((j) => j.status === 'failed' || j.status === 'cancelled')).toBe(true);
    });
  }

  it('lets only the scheduled worker claim across workspaces, and an owner only their own', async () => {
    await expect(as(db, OWNER_A, () => db.query(`select * from public.claim_automation_jobs(null, 'x', 5, 60)`))).rejects.toThrow(/Only the background worker/);
    await expect(as(db, OWNER_A, () => db.query(`select * from public.claim_automation_jobs($1, 'x', 5, 60)`, [orgB]))).rejects.toThrow(/does not allow automation/);
  });
});
