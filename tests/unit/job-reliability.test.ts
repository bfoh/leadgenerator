import { describe, expect, it } from 'vitest';
import { LocalAutomationStore } from '@/lib/automation/local-store';
import { AutomationError } from '@/lib/automation/store';
import type { AutomationJob } from '@/lib/automation/types';
import { MemoryStorage } from '@/lib/data/local-store';

// Job reliability soak on the demo queue (the database queue has the same soak in
// tests/db/job-reliability.test.ts): three workers claim, finish, crash, get cancelled and come back
// with stale leases in a seeded random order while the clock moves. After every step the queue must
// keep its promises: no job is held twice, attempts never pass the limit, a job succeeds at most
// once and is never claimed again, terminal jobs stay terminal, and a stale lease cannot finish.

/** Small seeded PRNG (mulberry32) so a failure can be replayed from its seed. */
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

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);
const CONCURRENCY = 3;

async function soak(seed: number) {
  const rnd = prng(seed);
  const pick = <T,>(list: readonly T[]) => list[Math.floor(rnd() * list.length)];
  let now = new Date('2026-10-22T10:00:00Z');
  const queue = new LocalAutomationStore(new MemoryStorage(), { clock: () => now });
  await queue.updateSettings({ maxConcurrentJobs: CONCURRENCY });

  for (let i = 0; i < 30; i++) await queue.enqueue({ agent: 'opportunity_scoring', businessId: `b${i}`, maxAttempts: 1 + Math.floor(rnd() * 4) });

  const workers = ['w1', 'w2', 'w3'];
  const held = new Map<string, AutomationJob[]>(workers.map((w) => [w, []]));
  const successes = new Map<string, number>();
  const terminalSeen = new Map<string, string>();
  let staleRejected = 0;

  const check = async () => {
    const jobs = await queue.listJobs({ limit: 1000 });
    expect(jobs.filter((j) => j.status === 'running').length).toBeLessThanOrEqual(CONCURRENCY);
    for (const j of jobs) {
      expect(j.attempts).toBeLessThanOrEqual(j.maxAttempts);
      expect(successes.get(j.id) ?? 0).toBeLessThanOrEqual(1);
      if (TERMINAL.has(j.status)) {
        expect(j.finishedAt).not.toBeNull();
        expect(j.leaseToken).toBeNull();
        // Terminal is final: only an explicit retry (not used here) may reopen a job.
        if (terminalSeen.has(j.id)) expect(j.status).toBe(terminalSeen.get(j.id));
        terminalSeen.set(j.id, j.status);
      } else {
        expect(j.finishedAt).toBeNull();
      }
      if (j.status === 'running') expect(j.leaseToken).not.toBeNull();
    }
    // Among the copies workers hold, at most one per job still matches the queue's lease.
    const live = new Map<string, number>();
    for (const list of held.values()) for (const h of list) if (jobs.find((j) => j.id === h.id)?.leaseToken === h.leaseToken) live.set(h.id, (live.get(h.id) ?? 0) + 1);
    for (const count of live.values()) expect(count).toBe(1);
  };

  const finish = async (worker: string, job: AutomationJob, request: Parameters<LocalAutomationStore['finish']>[1]) => {
    held.set(worker, held.get(worker)!.filter((h) => h !== job));
    const current = await queue.getJob(job.id);
    const valid = current?.status === 'running' && current.leaseToken === job.leaseToken;
    try {
      const after = await queue.finish(job, request);
      expect(valid).toBe(true);
      if (after.status === 'succeeded') successes.set(job.id, (successes.get(job.id) ?? 0) + 1);
    } catch (error) {
      expect(error).toBeInstanceOf(AutomationError);
      expect((error as AutomationError).code).toBe('stale_lease');
      expect(valid).toBe(false);
      staleRejected++;
    }
  };

  for (let step = 0; step < 600; step++) {
    const roll = rnd();
    const worker = pick(workers);
    const mine = held.get(worker)!;
    if (roll < 0.3) {
      const claimed = await queue.claim(worker, 1 + Math.floor(rnd() * 3), 30 + Math.floor(rnd() * 90));
      for (const j of claimed) {
        expect(terminalSeen.has(j.id)).toBe(false);
        expect(successes.has(j.id)).toBe(false);
      }
      mine.push(...claimed);
    } else if (roll < 0.62 && mine.length) {
      const job = pick(mine);
      const outcome = rnd();
      if (outcome < 0.5) await finish(worker, job, { outcome: 'succeeded' });
      else if (outcome < 0.75) await finish(worker, job, { outcome: 'retry', error: 'busy', errorKind: 'retryable', runAfter: new Date(now.getTime() + 20_000).toISOString() });
      else if (outcome < 0.82) await finish(worker, job, { outcome: 'retry', error: 'bad input', errorKind: 'permanent' });
      else if (outcome < 0.94) await finish(worker, job, { outcome: 'deferred', error: 'budget', errorKind: 'budget', runAfter: new Date(now.getTime() + 60_000).toISOString() });
      else await finish(worker, job, { outcome: 'failed', error: 'gave up', errorKind: 'permanent' });
    } else if (roll < 0.7 && mine.length) {
      // The worker crashes: it forgets the job, but keeps a stale copy that it may try to finish later.
      const job = mine.shift()!;
      held.get(pick(workers))!.push(job);
    } else if (roll < 0.74) {
      const jobs = (await queue.listJobs({ limit: 1000 })).filter((j) => j.status === 'pending' || j.status === 'running');
      if (jobs.length) await queue.cancel(pick(jobs).id, 'Soak test cancellation');
    } else {
      now = new Date(now.getTime() + Math.floor(rnd() * 90_000));
    }
    await check();
  }

  // Drain: every worker forgets what it held, time moves past every lease and retry, and the queue
  // is worked to the end. Every job must finish in a terminal state.
  for (const w of workers) held.set(w, []);
  for (let round = 0; round < 200; round++) {
    now = new Date(now.getTime() + 15 * 60_000);
    const claimed = await queue.claim('drain', 20, 60);
    if (!claimed.length && !(await queue.listJobs({ statuses: ['pending', 'running'] })).length) break;
    for (const job of claimed) {
      held.get('w1')!.push(job);
      await finish('w1', job, rnd() < 0.7 ? { outcome: 'succeeded' } : { outcome: 'retry', error: 'busy', errorKind: 'retryable' });
    }
    await check();
  }
  const jobs = await queue.listJobs({ limit: 1000 });
  expect(jobs.filter((j) => !TERMINAL.has(j.status))).toEqual([]);
  return { jobs, staleRejected, succeeded: jobs.filter((j) => j.status === 'succeeded').length };
}

describe('job queue reliability (demo store)', () => {
  for (const seed of [1, 7, 42, 2026]) {
    it(`keeps its guarantees under random claims, crashes, cancellations and stale leases (seed ${seed})`, async () => {
      const { jobs, staleRejected, succeeded } = await soak(seed);
      expect(jobs).toHaveLength(30);
      // The run exercised the failure paths, not only the happy one.
      expect(staleRejected).toBeGreaterThan(0);
      expect(succeeded).toBeGreaterThan(0);
      expect(jobs.some((j) => j.status === 'failed' || j.status === 'cancelled')).toBe(true);
    });
  }
});
