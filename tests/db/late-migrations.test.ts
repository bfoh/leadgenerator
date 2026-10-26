import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, as, createDatabase, createUser, rows } from './harness';

// Applying 008 and 010 *late*. On 25 October 2026 production was found holding 001–007 and 009–016
// but not 008 or 010, so both files have to land on a schema that already contains the later ones.
// This suite reproduces that shape on PGlite — skip 008 and 010, seed records the way the app has
// them, then apply 008 and 010 in order — and proves existing records survive untouched, both files
// are re-runnable, and the guards, reference data, indexes and grants they add work as the app
// expects.

const OWNER = '00000000-0000-4000-8000-0000000010a1';
const migration = (file: string) => readFileSync(join(MIGRATIONS_DIR, file), 'utf8');

let db: PGlite;
let org: string;
let pharmacy: string;
let sentProposal: string;
let reply: string;
let optOut: string;

type Row = Record<string, unknown>;

const one = async <T = Row>(sql: string, params: unknown[] = []) => (await rows<T>(db, sql, params))[0];
const count = async (sql: string) => (await one<{ n: number }>(sql)).n;
const asOwner = <T>(fn: () => Promise<T>) => as(db, OWNER, fn);

/** Every column of every record that existed before the upgrade (the new column excluded). */
async function snapshot() {
  return {
    businesses: await rows(db, `select to_jsonb(b) - 'district_code' as r from public.businesses b order by id`),
    proposals: await rows(db, 'select to_jsonb(p) as r from public.proposals p order by id'),
    messages: await rows(db, 'select to_jsonb(m) as r from public.inbound_messages m order by id'),
    versions: await count('select count(*)::int as n from public.proposal_versions'),
  };
}

describe('008 and 010 applied after the rest of the chain', () => {
  beforeAll(async () => {
    db = await createDatabase({ skip: ['008', '010'] });
    await createUser(db, OWNER, 'owner@late.example');
    org = (await asOwner(() => rows<{ org_id: string }>(db, 'select * from public.ensure_workspace()')))[0].org_id;

    pharmacy = (
      await asOwner(() =>
        rows<{ id: string }>(
          db,
          `insert into public.businesses (organization_id, name, category, region, city, contact_permission, lawful_basis, source_kind)
           values ($1, 'Late Pharmacy', 'Pharmacy', 'Ashanti', 'Kumasi', 'granted', 'consent', 'directory') returning id`,
          [org],
        ),
      )
    )[0].id;

    // An issued proposal with the approval time the app's pre-008 path always set by hand.
    sentProposal = (
      await asOwner(() =>
        rows<{ id: string }>(
          db,
          `insert into public.proposals (organization_id, business_id, title, status, approved_at, content)
           values ($1, $2, 'Website', 'sent', now(), '{"a":1}'::jsonb) returning id`,
          [org, pharmacy],
        ),
      )
    )[0].id;

    const message = (extra: Row = {}) =>
      asOwner(() =>
        rows<{ id: string }>(
          db,
          `insert into public.inbound_messages (organization_id, channel, provider, provider_message_id, sender_hash, sender_hint, body, received_at, opt_out, opt_out_match)
           values ($1, 'email', 'manual', $2, repeat('a', 64), 'c•••@example.com', 'How much?', now(), $3, $4) returning id`,
          [org, `in_${Math.random()}`, extra.opt_out ?? false, extra.opt_out_match ?? null],
        ),
      );
    reply = (await message())[0].id;
    optOut = (await message({ opt_out: true, opt_out_match: 'unsubscribe' }))[0].id;
  });

  it('stands where production stood: 009 and 011–016 installed, 008 and 010 not', async () => {
    expect(
      await count(
        `select count(*)::int as n from pg_class c join pg_namespace s on s.oid = c.relnamespace
          where s.nspname = 'public' and c.relkind = 'r'
            and c.relname in ('reply_classifications', 'proposal_change_requests', 'ghana_regions', 'ghana_districts')`,
      ),
    ).toBe(0);
    expect(
      await count(
        `select count(*)::int as n from information_schema.columns
          where table_schema = 'public' and table_name = 'businesses' and column_name = 'district_code'`,
      ),
    ).toBe(0);
    // The later migrations really are present, so the gap is 008 and 010 alone.
    expect(
      await count(
        `select count(*)::int as n from information_schema.tables
          where table_schema = 'public' and table_name in
            ('research_campaigns', 'provider_discovery_records', 'studio_assets', 'business_resource_entries')`,
      ),
    ).toBe(4);
  });

  it('applies 008 then 010 without changing a single existing record', async () => {
    const before = await snapshot();
    await db.exec(migration('008_response_conversion.sql'));
    await db.exec(migration('010_region_records.sql'));
    expect(await snapshot()).toEqual(before);
    // The one addition: an empty district on every record that predates it.
    expect(await count('select count(*)::int as n from public.businesses where district_code is not null')).toBe(0);
  });

  it('adds the tables, reference data, indexes and constraints 008 and 010 promise', async () => {
    expect(await count('select count(*)::int as n from public.ghana_regions')).toBe(16);
    expect(await count('select count(*)::int as n from public.ghana_districts')).toBe(261);
    expect(await count(`select count(*)::int as n from public.ghana_districts where code = 'GH10-GUAN'`)).toBe(1);
    expect(
      await count(
        `select count(*)::int as n from pg_constraint
          where conname = 'businesses_district_fk' and conrelid = 'public.businesses'::regclass and contype = 'f'`,
      ),
    ).toBe(1);
    expect(
      await count(
        `select count(*)::int as n from pg_indexes
          where schemaname = 'public' and indexname in
            ('businesses_org_district_idx', 'businesses_org_region_idx', 'reply_classifications_message_idx',
             'reply_classifications_org_idx', 'proposal_change_requests_proposal_idx', 'proposal_change_requests_org_idx',
             'ghana_districts_region_idx')`,
      ),
    ).toBe(7);
    expect(
      await count(
        `select count(*)::int as n from pg_trigger
          where not tgisinternal and tgname in ('proposals_acceptance_guard', 'businesses_district_sync',
            'reply_classifications_guard', 'proposal_change_requests_guard')`,
      ),
    ).toBe(4);
    // A town is now optional; the earlier check on it survives in the new form.
    expect(
      (
        await one<{ is_nullable: string }>(
          `select is_nullable from information_schema.columns
            where table_schema = 'public' and table_name = 'businesses' and column_name = 'city'`,
        )
      ).is_nullable,
    ).toBe('YES');
  });

  it('keeps an opt-out an opt-out, and the readings append-only', async () => {
    const classify = (messageId: string, intent: string) =>
      asOwner(() =>
        db.query(
          `insert into public.reply_classifications (organization_id, inbound_message_id, intent, confidence, source, classifier_version)
           values ($1, $2, $3, 80, 'rules', 'reply-rules-1.0.0')`,
          [org, messageId, intent],
        ),
      );
    await expect(classify(optOut, 'interested')).rejects.toThrow(/opt-out/);
    await classify(optOut, 'opt_out');
    await classify(reply, 'pricing_question');
    expect(await count('select count(*)::int as n from public.reply_classifications')).toBe(2);
    await expect(asOwner(() => db.query('update public.reply_classifications set confidence = 10'))).rejects.toThrow();
    await expect(asOwner(() => db.query('delete from public.reply_classifications'))).rejects.toThrow();
  });

  it('holds acceptance until a change is decided and written into a re-approved proposal', async () => {
    const [request] = await asOwner(() =>
      rows<{ id: string; status: string; business_id: string; requested_by: string | null }>(
        db,
        `insert into public.proposal_change_requests (organization_id, proposal_id, kind, summary)
         values ($1, $2, 'price', 'Reduce the price by 20%') returning id, status, business_id, requested_by`,
        [org, sentProposal],
      ),
    );
    expect(request.status).toBe('open');
    expect(request.business_id).toBe(pharmacy);
    expect(request.requested_by).toBe(OWNER);

    await expect(
      asOwner(() => db.query(`update public.proposals set status = 'accepted' where id = $1`, [sentProposal])),
    ).rejects.toThrow(/Decide the open change requests/);

    await asOwner(() =>
      db.query(`update public.proposal_change_requests set status = 'approved', decision_note = 'A smaller scope.' where id = $1`, [
        request.id,
      ]),
    );
    await expect(
      asOwner(() => db.query(`update public.proposals set status = 'accepted' where id = $1`, [sentProposal])),
    ).rejects.toThrow(/not in the proposal yet/);

    // Re-approving stamps a fresh approval time in the database, after the decision.
    await asOwner(() => db.query(`update public.proposals set status = 'approved' where id = $1`, [sentProposal]));
    const [accepted] = await asOwner(() =>
      rows<{ status: string; approved_at: string | null }>(
        db,
        `update public.proposals set status = 'accepted' where id = $1 returning status, approved_at`,
        [sentProposal],
      ),
    );
    expect(accepted.status).toBe('accepted');
    expect(accepted.approved_at).not.toBeNull();
  });

  it('lets a record be known only to district level, and fills or checks its region', async () => {
    const [district] = await asOwner(() =>
      rows<{ region: string | null; city: string | null }>(
        db,
        `insert into public.businesses (organization_id, name, category, district_code, contact_permission)
         values ($1, 'District Only', 'Pharmacy', 'GH0201', 'unknown') returning region, city`,
        [org],
      ),
    );
    expect(district).toEqual({ region: 'Ashanti', city: null });

    await expect(
      asOwner(() =>
        db.query(
          `insert into public.businesses (organization_id, name, category, district_code, region)
           values ($1, 'Wrong Region', 'Pharmacy', 'GH0201', 'Greater Accra')`,
          [org],
        ),
      ),
    ).rejects.toThrow(/is in Ashanti/);
    await expect(
      asOwner(() =>
        db.query(
          `insert into public.businesses (organization_id, name, category, district_code)
           values ($1, 'Unknown District', 'Pharmacy', 'GH9999')`,
          [org],
        ),
      ),
    ).rejects.toThrow(/Unknown district/);
    await expect(
      asOwner(() => db.query(`insert into public.businesses (organization_id, name, category) values ($1, 'Nowhere', 'Pharmacy')`, [org])),
    ).rejects.toThrow(/businesses_location_known/);

    // The record that existed before the upgrade is untouched.
    expect(
      await one('select city, region, district_code from public.businesses where id = $1', [pharmacy]),
    ).toEqual({ city: 'Kumasi', region: 'Ashanti', district_code: null });
  });

  it('grants app users only what they need, and anon nothing', async () => {
    const privileges = async (role: string, table: string) =>
      one<{ s: boolean; i: boolean; u: boolean; d: boolean }>(
        `select has_table_privilege($1, $2, 'select') as s, has_table_privilege($1, $2, 'insert') as i,
                has_table_privilege($1, $2, 'update') as u, has_table_privilege($1, $2, 'delete') as d`,
        [role, `public.${table}`],
      );
    expect(await privileges('anon', 'ghana_districts')).toEqual({ s: false, i: false, u: false, d: false });
    expect(await privileges('anon', 'reply_classifications')).toEqual({ s: false, i: false, u: false, d: false });
    expect(await privileges('authenticated', 'ghana_districts')).toEqual({ s: true, i: false, u: false, d: false });
    expect(await privileges('authenticated', 'ghana_regions')).toEqual({ s: true, i: false, u: false, d: false });
    expect(await privileges('authenticated', 'reply_classifications')).toEqual({ s: true, i: true, u: false, d: false });
    expect(await privileges('authenticated', 'proposal_change_requests')).toEqual({ s: true, i: true, u: true, d: false });
    expect(await privileges('service_role', 'reply_classifications')).toEqual({ s: true, i: true, u: false, d: false });
    expect(await privileges('service_role', 'proposal_change_requests')).toEqual({ s: true, i: false, u: false, d: false });

    expect(
      await count(
        `select count(*)::int as n from pg_policies where schemaname = 'public'
          and tablename in ('reply_classifications', 'proposal_change_requests', 'ghana_regions', 'ghana_districts')`,
      ),
    ).toBe(7);
    // Row-level security is on for all four new tables.
    expect(
      await count(
        `select count(*)::int as n from pg_class c join pg_namespace s on s.oid = c.relnamespace
          where s.nspname = 'public' and c.relrowsecurity
            and c.relname in ('reply_classifications', 'proposal_change_requests', 'ghana_regions', 'ghana_districts')`,
      ),
    ).toBe(4);
  });

  it('re-runs both files without duplicating reference data or losing records', async () => {
    const before = await snapshot();
    const classifications = await count('select count(*)::int as n from public.reply_classifications');
    const requests = await count('select count(*)::int as n from public.proposal_change_requests');

    await db.exec(migration('008_response_conversion.sql'));
    await db.exec(migration('010_region_records.sql'));

    expect(await snapshot()).toEqual(before);
    expect(await count('select count(*)::int as n from public.reply_classifications')).toBe(classifications);
    expect(await count('select count(*)::int as n from public.proposal_change_requests')).toBe(requests);
    expect(await count('select count(*)::int as n from public.ghana_regions')).toBe(16);
    expect(await count('select count(*)::int as n from public.ghana_districts')).toBe(261);
    expect(
      await count(
        `select count(*)::int as n from pg_policies where schemaname = 'public'
          and tablename in ('reply_classifications', 'proposal_change_requests', 'ghana_regions', 'ghana_districts')`,
      ),
    ).toBe(7);
  });
});
