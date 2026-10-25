-- Rollback for migration 013 (Studio business asset vault and Brand Kit).
--
-- Drops the vault tables, their history and the private bucket's policies and objects. Studio concepts
-- and brand intelligence from migration 012 are untouched. Asset files are deleted with the bucket:
-- this is deliberately destructive, and it is why the migration is not applied to production without
-- an explicit instruction.

do $$
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists studio_assets_storage_read on storage.objects';
    execute 'drop policy if exists studio_assets_storage_insert on storage.objects';
    execute 'drop policy if exists studio_assets_storage_update on storage.objects';
    execute 'drop policy if exists studio_assets_storage_delete on storage.objects';
    delete from storage.objects where bucket_id = 'studio-assets';
    delete from storage.buckets where id = 'studio-assets';
  end if;
end $$;

drop table if exists public.studio_brand_kit_approvals cascade;
drop table if exists public.studio_brand_kit_versions cascade;
drop table if exists public.studio_brand_kits cascade;
drop table if exists public.studio_asset_references cascade;
drop table if exists public.studio_asset_events cascade;
drop table if exists public.studio_assets cascade;

drop function if exists public.guard_studio_brand_kit_approval();
drop function if exists public.guard_studio_brand_kit_version();
drop function if exists public.guard_studio_asset_event_append_only();
