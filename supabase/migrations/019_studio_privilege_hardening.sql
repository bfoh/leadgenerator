-- Supabase's default privileges grant every role everything on a table a migration creates, and 014 and
-- 015 only granted on top of them. So on a real project all five Studio tables ended up holding the full
-- set for `anon`, `authenticated` and `service_role` — TRUNCATE included, which takes no account of
-- row-level security at all. This file takes back what neither migration meant to hand out.
--
-- What the Studio actually does with these tables, measured rather than assumed:
-- `src/lib/data/supabase-store.ts` reads and inserts through the signed-in user's client (`Authenticated`
-- mode in `src/lib/server/context.ts`), so members need select and insert. Nothing in the application
-- updates, deletes or truncates a brief, a review, a direction set or a prototype version — the lifecycle
-- is append-only by design, and the store has no such call. So:
--
--   `authenticated` loses delete and truncate on all five.
--   `anon` loses everything. No policy in 014 or 015 is written `to anon`, so nothing was ever readable
--     through the grant; it was a capability that should not exist.
--   `service_role` keeps select, insert, update and delete as 014 and 015 granted, for retention and
--     erasure work, and loses truncate, which no job needs and no code path reaches.
--
-- TRUNCATE is the serious half: it ignores row-level security, so one statement from any signed-in member
-- of any organization would empty every organization's Studio history at once. DELETE was only ever
-- stopped by the absence of a delete policy, which is one policy away from working.
--
-- UPDATE stays on `authenticated`, deliberately, exactly as 018 left it on the resource ledger. It is
-- inert here: 014 and 015 define select and insert policies and no update policy, so an update by a
-- member matches no row (`0 rows` measured on a fully migrated database) and never reaches the guard
-- trigger. The guard triggers, not the grant, are what refuse an edit; taking a privilege away that no
-- path can reach changes an error message and proves nothing. If the declared matrix (`select, insert`)
-- is ever wanted verbatim, that is a one-word change with its own test — recorded in the review, not
-- folded in here.
--
-- Privileges only: no data, no schema, no policy and no trigger changes, so this is safe on tables with
-- records and re-runnable as often as needed (a repeated revoke changes nothing).
--
-- Supabase's *default* privileges are deliberately untouched. They apply to every table a future
-- migration creates, not just these five, and the role that granted them has to be confirmed on the
-- project before anything tries to change them: an `alter default privileges` executed as a different
-- grantor silently changes nothing. That half is specified and evidenced separately in
-- docs/MIGRATION_REVIEW_019.md §6 and docs/PRODUCTION_RELEASE_GATE.md §5.3.

do $$
begin
  if to_regclass('public.studio_creative_briefs') is null
     or to_regclass('public.studio_creative_brief_reviews') is null
     or to_regclass('public.studio_creative_directions') is null
     or to_regclass('public.studio_creative_direction_reviews') is null
     or to_regclass('public.studio_website_prototypes') is null then
    raise exception 'Migration 019 needs the five Studio tables from migrations 014 and 015.';
  end if;
end $$;

revoke delete, truncate on
  public.studio_creative_briefs,
  public.studio_creative_brief_reviews,
  public.studio_creative_directions,
  public.studio_creative_direction_reviews,
  public.studio_website_prototypes
  from authenticated;

revoke all on
  public.studio_creative_briefs,
  public.studio_creative_brief_reviews,
  public.studio_creative_directions,
  public.studio_creative_direction_reviews,
  public.studio_website_prototypes
  from anon;

revoke truncate on
  public.studio_creative_briefs,
  public.studio_creative_brief_reviews,
  public.studio_creative_directions,
  public.studio_creative_direction_reviews,
  public.studio_website_prototypes
  from service_role;

-- Postgres 17 added MAINTAIN to ALL PRIVILEGES, so the same defaults also hand members `vacuum`, `analyze`,
-- `cluster`, `reindex` and `refresh` on these tables. It touches no row, but CLUSTER and REINDEX take an
-- exclusive lock, so one member of one organization could stall every organization's Studio writes. 15 and
-- 16 have no such privilege, so this branch is skipped there instead of failing the file.
do $$
begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'revoke maintain on public.studio_creative_briefs, public.studio_creative_brief_reviews, '
         || 'public.studio_creative_directions, public.studio_creative_direction_reviews, '
         || 'public.studio_website_prototypes from authenticated, service_role';
  end if;
end $$;
