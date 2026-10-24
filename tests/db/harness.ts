// Runs the real Supabase migrations on PGlite (Postgres compiled to WASM) with a minimal stub of
// Supabase's auth schema and roles, so RLS policies can be exercised in CI without Docker.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, last_sign_in_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  -- Supabase grants the service role every new table through default privileges, at creation, so a
  -- migration's own revokes (append-only consent records, say) still apply afterwards.
  alter default privileges in schema public grant all on tables to service_role;
  alter default privileges in schema public grant all on sequences to service_role;
`;

export const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

export function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

export async function createDatabase(
  options: {
    before002?: (db: PGlite) => Promise<void>;
    before003?: (db: PGlite) => Promise<void>;
    before004?: (db: PGlite) => Promise<void>;
    before005?: (db: PGlite) => Promise<void>;
    skip?: string[];
  } = {},
) {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  for (const file of migrationFiles()) {
    if (options.skip?.some((prefix) => file.startsWith(prefix))) continue;
    if (file.startsWith('002') && options.before002) await options.before002(db);
    if (file.startsWith('003') && options.before003) await options.before003(db);
    if (file.startsWith('004') && options.before004) await options.before004(db);
    if (file.startsWith('005') && options.before005) await options.before005(db);
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return db;
}

export async function createUser(db: PGlite, id: string, email: string, confirmed = true) {
  await db.query('insert into auth.users (id, email, email_confirmed_at) values ($1, $2, $3)', [id, email, confirmed ? new Date().toISOString() : null]);
}

/** Runs fn as an authenticated user (or anon when userId is null), then restores the superuser role. */
export async function as<T>(db: PGlite, userId: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`select set_config('request.jwt.claim.sub', '${userId ?? ''}', false)`);
  await db.exec(`set role ${userId ? 'authenticated' : 'anon'}`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
    await db.exec(`select set_config('request.jwt.claim.sub', '', false)`);
  }
}

/** Runs fn with the service-role key's claims (the scheduled worker), then restores the superuser role. */
export async function asServiceRole<T>(db: PGlite, fn: () => Promise<T>): Promise<T> {
  await db.exec(`select set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
  await db.exec('set role service_role');
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
    await db.exec(`select set_config('request.jwt.claims', '', false)`);
  }
}

export async function rows<T = Record<string, unknown>>(db: PGlite, sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows;
}

/** Wednesday 10:00 Ghana time: inside the default sending window, whenever the suite runs. */
export const FIXED_MESSAGING_NOW = '2026-10-21 10:00:00+00';

/** Points the send-policy trigger's clock (migration 007) at a fixed time. */
export async function freezeMessagingClock(db: PGlite, at = FIXED_MESSAGING_NOW) {
  if (!/^[0-9: +-]+$/.test(at)) throw new Error('Pass a timestamp literal.');
  await db.exec(`create or replace function public.messaging_now() returns timestamptz language sql stable set search_path = '' as $$ select '${at}'::timestamptz $$`);
}

