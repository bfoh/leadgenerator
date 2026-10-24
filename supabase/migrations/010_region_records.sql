-- Digital Opportunity Finder — region-level records and Ghana districts (milestone 2).
--
-- A business can now be known at district or region level, before anyone has a town: `city` becomes
-- optional, `district_code` references the official district list, and the trigger fills or checks
-- the region. Existing rows are untouched (they all have a town), and every existing constraint that
-- mattered still holds.
--
-- The district list is Ghana's 261 metropolitan, municipal and district assemblies, from the same
-- verified source as src/lib/domain/districts.ts (OCHA/HDX COD-AB v01, Ghana Statistical Service
-- data, CC BY-IGO 3.0, valid from 8 March 2021, reviewed 30 October 2025), plus Guan District. The
-- table is the database's copy for referential integrity; tests compare it with the TypeScript list.
--
-- Additive and re-runnable. Rollback: supabase/rollback/010_region_records_down.sql.

do $$
begin
  if to_regclass('public.businesses') is null then
    raise exception 'Migration 010 needs migration 002; apply it first.';
  end if;
end $$;

-- ─── Reference geography ─────────────────────────────────────────────────────────────────────────

create table if not exists public.ghana_regions (
  code text primary key check (code ~ '^GH[0-9]{2}$'),
  name text not null unique check (char_length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now()
);

create table if not exists public.ghana_districts (
  code text primary key check (code ~ '^GH[0-9]{4}$' or code = 'GH10-GUAN'),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  region text not null references public.ghana_regions(name) on update cascade,
  /** The source's name when the app shortens it (for example "… Municipal"). */
  source_name text check (char_length(source_name) <= 120),
  created_at timestamptz not null default now()
);
create index if not exists ghana_districts_region_idx on public.ghana_districts(region, name);

insert into public.ghana_regions (code, name) values
  ('GH01', 'Ahafo'),
  ('GH02', 'Ashanti'),
  ('GH03', 'Bono'),
  ('GH04', 'Bono East'),
  ('GH05', 'Central'),
  ('GH06', 'Eastern'),
  ('GH07', 'Greater Accra'),
  ('GH08', 'Northern'),
  ('GH09', 'North East'),
  ('GH10', 'Oti'),
  ('GH11', 'Savannah'),
  ('GH12', 'Upper East'),
  ('GH13', 'Upper West'),
  ('GH14', 'Volta'),
  ('GH15', 'Western'),
  ('GH16', 'Western North')
on conflict (code) do update set name = excluded.name;

insert into public.ghana_districts (code, name, region, source_name) values
  ('GH0101', 'Asunafo North', 'Ahafo', 'Asunafo North Municipal'),
  ('GH0102', 'Asunafo South', 'Ahafo', null),
  ('GH0103', 'Asutifi North', 'Ahafo', null),
  ('GH0104', 'Asutifi South', 'Ahafo', null),
  ('GH0105', 'Tano North', 'Ahafo', 'Tano North Municipal'),
  ('GH0106', 'Tano South', 'Ahafo', 'Tano South Municipal'),
  ('GH0201', 'Adansi Akrofuom', 'Ashanti', null),
  ('GH0202', 'Adansi Asokwa', 'Ashanti', null),
  ('GH0203', 'Adansi North', 'Ashanti', null),
  ('GH0204', 'Adansi South', 'Ashanti', null),
  ('GH0205', 'Afigya Kwabre North', 'Ashanti', null),
  ('GH0206', 'Afigya Kwabre South', 'Ashanti', null),
  ('GH0207', 'Ahafo Ano North', 'Ashanti', null),
  ('GH0208', 'Ahafo Ano South East', 'Ashanti', null),
  ('GH0209', 'Ahafo Ano South West', 'Ashanti', null),
  ('GH0210', 'Amansie Central', 'Ashanti', null),
  ('GH0211', 'Amansie South', 'Ashanti', null),
  ('GH0212', 'Amansie West', 'Ashanti', null),
  ('GH0213', 'Asante Akim Central', 'Ashanti', 'Asante Akim Central Municipal'),
  ('GH0214', 'Asante Akim North', 'Ashanti', null),
  ('GH0215', 'Asante Akim South', 'Ashanti', null),
  ('GH0216', 'Asokore Mampong', 'Ashanti', 'Asokore Mampong Municipal'),
  ('GH0217', 'Asokwa', 'Ashanti', 'Asokwa Municipal'),
  ('GH0218', 'Atwima Kwanwoma', 'Ashanti', null),
  ('GH0219', 'Atwima Mponua', 'Ashanti', null),
  ('GH0220', 'Atwima Nwabiagya North', 'Ashanti', null),
  ('GH0221', 'Atwima Nwabiagya South', 'Ashanti', null),
  ('GH0222', 'Bekwai', 'Ashanti', 'Bekwai Municipal'),
  ('GH0223', 'Bosome Freho', 'Ashanti', null),
  ('GH0224', 'Bosomtwe', 'Ashanti', null),
  ('GH0225', 'Ejisu', 'Ashanti', 'Ejisu Municipal'),
  ('GH0226', 'Ejura-Sekyedumase', 'Ashanti', null),
  ('GH0227', 'Juaben', 'Ashanti', 'Juaben Municipal'),
  ('GH0228', 'Kumasi', 'Ashanti', 'Kumasi Metropolitan'),
  ('GH0229', 'Kwabre East', 'Ashanti', null),
  ('GH0230', 'Kwadaso', 'Ashanti', 'Kwadaso Municipal'),
  ('GH0231', 'Mampong', 'Ashanti', 'Mampong Municipal'),
  ('GH0232', 'Obuasi East', 'Ashanti', null),
  ('GH0233', 'Obuasi', 'Ashanti', 'Obuasi Municipal'),
  ('GH0234', 'Offinso', 'Ashanti', 'Offinso Municipal'),
  ('GH0235', 'Offinso North', 'Ashanti', null),
  ('GH0236', 'Oforikrom', 'Ashanti', 'Oforikrom Municipal'),
  ('GH0237', 'Old Tafo', 'Ashanti', 'Old Tafo Municipal'),
  ('GH0238', 'Sekyere Afram Plains North', 'Ashanti', null),
  ('GH0239', 'Sekyere Central', 'Ashanti', null),
  ('GH0240', 'Sekyere East', 'Ashanti', null),
  ('GH0241', 'Sekyere Kumawu', 'Ashanti', null),
  ('GH0242', 'Sekyere South', 'Ashanti', null),
  ('GH0243', 'Suame', 'Ashanti', 'Suame Municipal'),
  ('GH0301', 'Banda', 'Bono', null),
  ('GH0302', 'Berekum East', 'Bono', 'Berekum East Municipal'),
  ('GH0303', 'Berekum West', 'Bono', null),
  ('GH0304', 'Dormaa East', 'Bono', null),
  ('GH0305', 'Dormaa', 'Bono', 'Dormaa Municipal'),
  ('GH0306', 'Dormaa West', 'Bono', null),
  ('GH0307', 'Jaman North', 'Bono', null),
  ('GH0308', 'Jaman South', 'Bono', 'Jaman South Municipal'),
  ('GH0309', 'Sunyani', 'Bono', 'Sunyani Municipal'),
  ('GH0310', 'Sunyani West', 'Bono', null),
  ('GH0311', 'Tain', 'Bono', null),
  ('GH0312', 'Wenchi', 'Bono', 'Wenchi Municipal'),
  ('GH0401', 'Atebubu Amantin', 'Bono East', null),
  ('GH0402', 'Kintampo North', 'Bono East', 'Kintampo North Municipal'),
  ('GH0403', 'Kintampo South', 'Bono East', null),
  ('GH0404', 'Nkoranza North', 'Bono East', null),
  ('GH0405', 'Nkoranza South', 'Bono East', null),
  ('GH0406', 'Pru East', 'Bono East', null),
  ('GH0407', 'Pru West', 'Bono East', null),
  ('GH0408', 'Sene East', 'Bono East', null),
  ('GH0409', 'Sene West', 'Bono East', null),
  ('GH0410', 'Techiman', 'Bono East', 'Techiman Municipal'),
  ('GH0411', 'Techiman North', 'Bono East', null),
  ('GH0501', 'Abura-Asebu-Kwamankese', 'Central', null),
  ('GH0502', 'Agona East', 'Central', null),
  ('GH0503', 'Agona West', 'Central', 'Agona West Municipal'),
  ('GH0504', 'Ajumako-Enyan-Essiam', 'Central', null),
  ('GH0505', 'Asikuma-Odoben-Brakwa', 'Central', null),
  ('GH0506', 'Assin Fosu', 'Central', null),
  ('GH0507', 'Assin North', 'Central', null),
  ('GH0508', 'Assin South', 'Central', null),
  ('GH0509', 'Awutu Senya', 'Central', null),
  ('GH0510', 'Awutu Senya East', 'Central', null),
  ('GH0511', 'Cape Coast', 'Central', 'Cape Coast Metropolitan'),
  ('GH0512', 'Effutu', 'Central', 'Effutu Municipal'),
  ('GH0513', 'Ekumfi', 'Central', null),
  ('GH0514', 'Gomoa Central', 'Central', null),
  ('GH0515', 'Gomoa East', 'Central', null),
  ('GH0516', 'Gomoa West', 'Central', null),
  ('GH0517', 'Komenda-Edina-Eguafo-Abirem', 'Central', 'Komenda-Edina-Eguafo-Abirem Municipal'),
  ('GH0518', 'Mfantseman', 'Central', 'Mfantseman Municipal'),
  ('GH0519', 'Twifo Atti-Morkwa', 'Central', null),
  ('GH0520', 'Twifo Hemang Lower Denkyira', 'Central', null),
  ('GH0521', 'Upper Denkyira East', 'Central', 'Upper Denkyira East Municipal'),
  ('GH0522', 'Upper Denkyira West', 'Central', null),
  ('GH0601', 'Abuakwa North', 'Eastern', null),
  ('GH0602', 'Abuakwa South', 'Eastern', null),
  ('GH0603', 'Achiase', 'Eastern', null),
  ('GH0604', 'Akwapem North', 'Eastern', null),
  ('GH0605', 'Akwapem South', 'Eastern', null),
  ('GH0606', 'Akyem Mansa', 'Eastern', null),
  ('GH0607', 'Asene Akroso Manso', 'Eastern', null),
  ('GH0608', 'Asuogyaman', 'Eastern', null),
  ('GH0609', 'Atiwa East', 'Eastern', null),
  ('GH0610', 'Atiwa West', 'Eastern', null),
  ('GH0611', 'Ayensuano', 'Eastern', null),
  ('GH0612', 'Birim Central', 'Eastern', 'Birim Central Municipal'),
  ('GH0613', 'Birim North', 'Eastern', null),
  ('GH0614', 'Birim South', 'Eastern', null),
  ('GH0615', 'Denkyembour', 'Eastern', null),
  ('GH0616', 'Fanteakwa North', 'Eastern', null),
  ('GH0617', 'Fanteakwa South', 'Eastern', null),
  ('GH0618', 'Kwaebibirem', 'Eastern', null),
  ('GH0619', 'Kwahu Afram Plains North', 'Eastern', null),
  ('GH0620', 'Kwahu Afram Plains South', 'Eastern', null),
  ('GH0621', 'Kwahu East', 'Eastern', null),
  ('GH0622', 'Kwahu South', 'Eastern', null),
  ('GH0623', 'Kwahu West', 'Eastern', null),
  ('GH0624', 'Lower Manya', 'Eastern', null),
  ('GH0625', 'New Juaben North', 'Eastern', 'New Juaben North Municipal'),
  ('GH0626', 'New Juaben South', 'Eastern', 'New Juaben South Municipal'),
  ('GH0627', 'Nsawam Adoagyiri', 'Eastern', null),
  ('GH0628', 'Okere', 'Eastern', null),
  ('GH0629', 'Suhum', 'Eastern', 'Suhum Municipal'),
  ('GH0630', 'Upper Manya', 'Eastern', null),
  ('GH0631', 'Upper West Akim', 'Eastern', null),
  ('GH0632', 'West Akim', 'Eastern', null),
  ('GH0633', 'Yilo Krobo', 'Eastern', null),
  ('GH0701', 'Ablekuma Central', 'Greater Accra', 'Ablekuma Central Municipal'),
  ('GH0702', 'Ablekuma North', 'Greater Accra', 'Ablekuma North Municipal'),
  ('GH0703', 'Ablekuma West', 'Greater Accra', 'Ablekuma West Municipal'),
  ('GH0704', 'Accra', 'Greater Accra', 'Accra Metropolis'),
  ('GH0705', 'Ada East', 'Greater Accra', null),
  ('GH0706', 'Ada West', 'Greater Accra', null),
  ('GH0707', 'Adenta', 'Greater Accra', 'Adenta Municipal'),
  ('GH0708', 'Ashaiman', 'Greater Accra', 'Ashaiman Municipal'),
  ('GH0709', 'Ayawaso Central', 'Greater Accra', 'Ayawaso Central Municipal'),
  ('GH0710', 'Ayawaso East', 'Greater Accra', 'Ayawaso East Municipal'),
  ('GH0711', 'Ayawaso North', 'Greater Accra', 'Ayawaso North Municipal'),
  ('GH0712', 'Ayawaso West', 'Greater Accra', null),
  ('GH0713', 'Ga Central', 'Greater Accra', 'Ga Central Municipal'),
  ('GH0714', 'Ga East', 'Greater Accra', null),
  ('GH0715', 'Ga North', 'Greater Accra', 'Ga North Municipal'),
  ('GH0716', 'Ga South', 'Greater Accra', 'Ga South Municipal'),
  ('GH0717', 'Ga West', 'Greater Accra', 'Ga West Municipal'),
  ('GH0718', 'Korle Klottey', 'Greater Accra', 'Korle Klottey Municipal'),
  ('GH0719', 'Kpone Katamanso', 'Greater Accra', null),
  ('GH0720', 'Krowor', 'Greater Accra', 'Krowor Municipal'),
  ('GH0721', 'La Dade-Kotopon', 'Greater Accra', null),
  ('GH0722', 'La-Nkwantanang-Madina', 'Greater Accra', null),
  ('GH0723', 'Ledzokuku', 'Greater Accra', 'Ledzokuku Municipal'),
  ('GH0724', 'Ningo/Prampram', 'Greater Accra', null),
  ('GH0725', 'Okaikwei North', 'Greater Accra', 'Okaikwei North Municipal'),
  ('GH0726', 'Shai Osudoku', 'Greater Accra', null),
  ('GH0727', 'Tema', 'Greater Accra', 'Tema Metropolitan'),
  ('GH0728', 'Tema West', 'Greater Accra', 'Tema West Municipal'),
  ('GH0729', 'Weija Gbawe', 'Greater Accra', 'Weija Gbawe Municipal'),
  ('GH0801', 'Gushegu', 'Northern', null),
  ('GH0802', 'Karaga', 'Northern', null),
  ('GH0803', 'Kpandai', 'Northern', null),
  ('GH0804', 'Kumbungu', 'Northern', null),
  ('GH0805', 'Mion', 'Northern', null),
  ('GH0806', 'Nanton', 'Northern', null),
  ('GH0807', 'Nanumba North', 'Northern', null),
  ('GH0808', 'Nanumba South', 'Northern', null),
  ('GH0809', 'Saboba', 'Northern', null),
  ('GH0810', 'Sagnerigu', 'Northern', null),
  ('GH0811', 'Savelugu', 'Northern', null),
  ('GH0812', 'Tamale', 'Northern', 'Tamale Metropolitan'),
  ('GH0813', 'Tatale Sanguli', 'Northern', null),
  ('GH0814', 'Tolon', 'Northern', null),
  ('GH0815', 'Yendi', 'Northern', 'Yendi Municipal'),
  ('GH0816', 'Zabzugu', 'Northern', null),
  ('GH0901', 'Bunkpurugu Nakpanduri', 'North East', null),
  ('GH0902', 'Chereponi', 'North East', null),
  ('GH0903', 'East Mamprusi', 'North East', null),
  ('GH0904', 'Mamprugu Moagduri', 'North East', null),
  ('GH0905', 'West Mamprusi', 'North East', 'West Mamprusi Municipal'),
  ('GH0906', 'Yunyoo-Nasuan', 'North East', null),
  ('GH1001', 'Biakoye', 'Oti', null),
  ('GH1002', 'Jasikan', 'Oti', null),
  ('GH1003', 'Kadjebi', 'Oti', null),
  ('GH1004', 'Krachi East', 'Oti', 'Krachi East Municipal'),
  ('GH1005', 'Krachi Nchumuru', 'Oti', null),
  ('GH1006', 'Krachi West', 'Oti', null),
  ('GH1007', 'Nkwanta North', 'Oti', null),
  ('GH1008', 'Nkwanta South', 'Oti', 'Nkwanta South Municipal'),
  ('GH1101', 'Bole', 'Savannah', null),
  ('GH1102', 'Central Gonja', 'Savannah', null),
  ('GH1103', 'East Gonja', 'Savannah', 'East Gonja Municipal'),
  ('GH1104', 'North East Gonja', 'Savannah', null),
  ('GH1105', 'North Gonja', 'Savannah', null),
  ('GH1106', 'Sawla-Tuna-Kalba', 'Savannah', null),
  ('GH1107', 'West Gonja', 'Savannah', null),
  ('GH1201', 'Bawku', 'Upper East', 'Bawku Municipal'),
  ('GH1202', 'Bawku West', 'Upper East', null),
  ('GH1203', 'Binduri', 'Upper East', null),
  ('GH1204', 'Bolga East', 'Upper East', null),
  ('GH1205', 'Bolgatanga', 'Upper East', 'Bolgatanga Municipal'),
  ('GH1206', 'Bongo', 'Upper East', null),
  ('GH1207', 'Builsa North', 'Upper East', null),
  ('GH1208', 'Builsa South', 'Upper East', null),
  ('GH1209', 'Garu', 'Upper East', null),
  ('GH1210', 'Kasena Nankana East', 'Upper East', null),
  ('GH1211', 'Kasena Nankana West', 'Upper East', null),
  ('GH1212', 'Nabdam', 'Upper East', null),
  ('GH1213', 'Pusiga', 'Upper East', null),
  ('GH1214', 'Talensi', 'Upper East', null),
  ('GH1215', 'Tempane', 'Upper East', null),
  ('GH1301', 'Daffiama Bussie Issa', 'Upper West', null),
  ('GH1302', 'Jirapa', 'Upper West', null),
  ('GH1303', 'Lambussie-Karni', 'Upper West', null),
  ('GH1304', 'Lawra', 'Upper West', null),
  ('GH1305', 'Nadowli-Kaleo', 'Upper West', null),
  ('GH1306', 'Nandom', 'Upper West', null),
  ('GH1307', 'Sissala East', 'Upper West', null),
  ('GH1308', 'Sissala West', 'Upper West', null),
  ('GH1309', 'Wa East', 'Upper West', null),
  ('GH1310', 'Wa', 'Upper West', 'Wa Municipal'),
  ('GH1311', 'Wa West', 'Upper West', null),
  ('GH1401', 'Adaklu', 'Volta', null),
  ('GH1402', 'Afadzato South', 'Volta', null),
  ('GH1403', 'Agotime Ziope', 'Volta', null),
  ('GH1404', 'Akatsi North', 'Volta', null),
  ('GH1405', 'Akatsi South', 'Volta', null),
  ('GH1406', 'Anloga', 'Volta', null),
  ('GH1407', 'Central Tongu', 'Volta', null),
  ('GH1408', 'Ho', 'Volta', 'Ho Municipal'),
  ('GH1409', 'Ho West', 'Volta', null),
  ('GH1410', 'Hohoe', 'Volta', 'Hohoe Municipal'),
  ('GH1411', 'Keta', 'Volta', 'Keta Municipal'),
  ('GH1412', 'Ketu North', 'Volta', null),
  ('GH1413', 'Ketu South', 'Volta', null),
  ('GH1414', 'Kpando', 'Volta', 'Kpando Municipal'),
  ('GH1415', 'North Dayi', 'Volta', null),
  ('GH1416', 'North Tongu', 'Volta', null),
  ('GH1417', 'South Dayi', 'Volta', null),
  ('GH1418', 'South Tongu', 'Volta', null),
  ('GH1501', 'Ahanta West', 'Western', 'Ahanta West Municipal'),
  ('GH1502', 'Effia Kwesimintsim', 'Western', 'Effia Kwesimintsim Municipal'),
  ('GH1503', 'Ellembelle', 'Western', null),
  ('GH1504', 'Jomoro', 'Western', null),
  ('GH1505', 'Mpohor', 'Western', null),
  ('GH1506', 'Nzema East', 'Western', null),
  ('GH1507', 'Prestea/Huni Valley', 'Western', null),
  ('GH1508', 'Sekondi Takoradi', 'Western', 'Sekondi Takoradi Metropolis'),
  ('GH1509', 'Shama', 'Western', null),
  ('GH1510', 'Tarkwa Nsuaem', 'Western', null),
  ('GH1511', 'Wassa Amenfi Central', 'Western', null),
  ('GH1512', 'Wassa Amenfi East', 'Western', null),
  ('GH1513', 'Wassa Amenfi West', 'Western', null),
  ('GH1514', 'Wassa East', 'Western', null),
  ('GH1601', 'Aowin', 'Western North', null),
  ('GH1602', 'Bia East', 'Western North', null),
  ('GH1603', 'Bia West', 'Western North', null),
  ('GH1604', 'Bibiani-Anhwiaso-Bekwai', 'Western North', 'Bibiani-Anhwiaso-Bekwai Municipal'),
  ('GH1605', 'Bodi', 'Western North', null),
  ('GH1606', 'Juaboso', 'Western North', null),
  ('GH1607', 'Sefwi Akontombra', 'Western North', null),
  ('GH1608', 'Sefwi-Wiawso', 'Western North', null),
  ('GH1609', 'Suaman', 'Western North', null),
  ('GH10-GUAN', 'Guan', 'Oti', null)
on conflict (code) do update set name = excluded.name, region = excluded.region, source_name = excluded.source_name;

-- ─── Location on businesses ──────────────────────────────────────────────────────────────────────

alter table public.businesses add column if not exists district_code text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'businesses_district_fk') then
    alter table public.businesses add constraint businesses_district_fk
      foreign key (district_code) references public.ghana_districts(code) on update cascade;
  end if;
end $$;
create index if not exists businesses_org_district_idx on public.businesses(organization_id, district_code) where district_code is not null;
create index if not exists businesses_org_region_idx on public.businesses(organization_id, region) where region is not null;

-- A district fills in its region, and a region that contradicts its district is refused.
create or replace function public.sync_business_district() returns trigger
language plpgsql set search_path = '' as $$
declare
  d public.ghana_districts%rowtype;
begin
  if new.district_code is not null then
    select * into d from public.ghana_districts where code = new.district_code;
    if d.code is null then
      raise exception 'Unknown district code %.', new.district_code using errcode = '23503';
    end if;
    if new.region is null or btrim(new.region) = '' then
      new.region := d.region;
    elsif new.region is distinct from d.region then
      raise exception 'District % is in %, not %.', d.name, d.region, new.region using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists businesses_district_sync on public.businesses;
create trigger businesses_district_sync before insert or update of district_code, region on public.businesses
  for each row execute function public.sync_business_district();

-- `city` is no longer required: a record may be known only to district or region level. A town that
-- is present still has to be a real value, and every record must state at least a region or a town.
alter table public.businesses alter column city drop not null;
alter table public.businesses drop constraint if exists businesses_city_check;
alter table public.businesses add constraint businesses_city_check
  check (city is null or char_length(btrim(city)) between 1 and 80);
alter table public.businesses drop constraint if exists businesses_location_known;
alter table public.businesses add constraint businesses_location_known
  check (region is not null or city is not null);

-- ─── Row Level Security and grants ───────────────────────────────────────────────────────────────

alter table public.ghana_regions enable row level security;
alter table public.ghana_districts enable row level security;

-- Reference data is read-only to app users; only an owner of the database (a migration) changes it.
drop policy if exists ghana_regions_select on public.ghana_regions;
create policy ghana_regions_select on public.ghana_regions for select to authenticated using (true);
drop policy if exists ghana_districts_select on public.ghana_districts;
create policy ghana_districts_select on public.ghana_districts for select to authenticated using (true);

revoke all on public.ghana_regions, public.ghana_districts from anon, authenticated;
grant select on public.ghana_regions, public.ghana_districts to authenticated;
grant select on public.ghana_regions, public.ghana_districts to service_role;
