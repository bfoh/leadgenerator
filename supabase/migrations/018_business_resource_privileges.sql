-- Supabase's default privileges grant every role everything on a table a migration creates, and 016 only
-- granted on top of them. So on a real project `authenticated` kept DELETE and TRUNCATE on the resource
-- ledger, and `anon` kept the full set. TRUNCATE is the serious half: it takes no row-level security into
-- account, so one statement from any signed-in member would empty every organization's collected facts at
-- once. DELETE was only ever blocked by the absence of a delete policy, which is one policy away from
-- working.
--
-- A resource entry is revoked, never deleted: the guard trigger confines an update to `revoked_at` and the
-- application only ever inserts, reads and stamps that column. Members therefore keep select, insert and
-- the one-way revoke update, and lose delete and truncate. Anonymous visitors have no reason to touch this
-- table at all, so they keep nothing. The worker keeps delete for retention and erasure jobs and loses
-- truncate, which no job needs and no code path reaches.
--
-- Privileges only: no data, no schema, no policy and no trigger changes, so this is safe on a table with
-- records and re-runnable as often as needed (a repeated revoke changes nothing).

revoke delete, truncate on public.business_resource_entries from authenticated;
revoke all on public.business_resource_entries from anon;
revoke truncate on public.business_resource_entries from service_role;
