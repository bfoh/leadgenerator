# Staging the Google Resource Collector (one real listing, in a browser)

Prepared 26 October 2026 on `feature/google-business-resource-collector`. **Nothing here has been run.**
No paid call is authorised by this document, no staging project exists yet, and production Supabase is
not touched by any step. It is the shortest sequence that can show the complete real-listing experience:
the actual Google listing rendered in the app, its photo attribution, the guarded website read, the
Place ID save, an upload into the vault, and a Website Resource Kit ZIP — all on a throwaway project.

Context: the provider itself is already verified. One controlled Place Details request on 25 October 2026
returned HTTP 200 and the mapping parsed correctly — one photo with its author credit and source link,
seven hours, phone listed, website listed false — inside a `$0.03` cap that reserved `$0.025` and left no
room for a second paid call. The run log is kept in the private change record, not in this repository,
and it holds counts and the Place ID only. What has never been shown is that same listing arriving
through the product's own UI, which is what this procedure covers.

The business under test is the same one chosen for that check: a real Ghanaian listing with no website.
Its name, address, phone, hours and photo stay in the private change record. Nothing in this repository
or in the evidence it asks you to keep may contain them.

## 1. What the run has to demonstrate

Open **Collect Business Resources** on a prospect (`/prospects/:id/resources`). In one session, with the
real listing:

| # | Expected on screen | Where it comes from |
| --- | --- | --- |
| 1.1 | Name, address, phone, hours, operational status, a Google Maps link, the Google Maps logo, and **no embedded map** | `src/components/resources/resource-collector.tsx` |
| 1.2 | One photo reference with the author's avatar, name and profile link plus "View this photo on Google Maps" | `photo.authors`, `photo.googleMapsUri` |
| 1.3 | "No website on the Google listing", with the guarded homepage read offered only after an explicit independent-verification confirmation | `action: 'website'` in `src/app/api/resources/route.ts` |
| 1.4 | After saving, a reload shows the Place ID still retained and **no other Google content** | `placesPlaceId` on the business row |
| 1.5 | An independent entry with source, evidence and export permission can be added and revoked | migration 016 ledger |
| 1.6 | An uploaded file becomes a vault candidate, is approved, then appears in the kit ZIP | migration 013 vault |
| 1.7 | The ZIP contains `business-resources.json`, `manifest.json`, `MISSING-RESOURCES.md`, `DEVELOPMENT-BRIEF.md` and no Google address, Place ID or `googleusercontent` URL | `downloadWebsiteResourceKit` |

## 2. Why this cannot be done in demo mode

Read from the code, not from preference:

- `src/lib/server/resource-collector.ts` → `googleCall()` throws **403 "Live collector calls require an
  authenticated workspace."** whenever `ctx.mode === 'demo'`.
- `serverEnv.simulateExternalTools()` is `SIMULATE_EXTERNAL_TOOLS=true` **and not** `isSupabaseConfigured()`.
  Configure Supabase and simulation switches itself off.
- So `resourceGoogleStatus()` can only be truly `enabled` (not `simulated`) in cloud mode, and cloud mode
  means a Supabase project — which is why the browser run needs staging, and never production.

| Mode | What it can prove |
| --- | --- |
| Demo, `SIMULATE_EXTERNAL_TOOLS=true` | Layout, states, permissions and the ZIP, with a fictional bakery. Already covered by the existing suites and `docs/evidence/resource-collector`. |
| Demo, simulation off | Nothing about Google: 503 disabled, or 403 in demo mode. |
| Cloud staging, collector enabled | The real listing, real attribution and real Place ID retention. **This is the gap.** |

## 3. Minimum staging Supabase

A **second** Supabase project (never the live project ref). `LIVE_GOOGLE_RESOURCE_TEST.md` allows two
alternatives: a local Supabase stack (Docker plus the CLI, `supabase init/start/db reset`) or "a separate
staging project the owner explicitly authorizes". Neither is installed on this machine and
`supabase/config.toml` does not exist, so the second option is the shorter path; a Supabase preview
branch is equivalent if the plan offers one, as long as the data in it is disposable. Apply only what the
collector page touches:

| Migration | Needed because | Without it |
| --- | --- | --- |
| `002_workspace_model.sql` | organizations, membership, RLS, `ensure_workspace()`, audit, usage ledger | Nothing works: sign-in fails, no RLS scope |
| `012_studio_brand_intelligence.sql` | `openResourceVault()` creates and resolves the prospect's Studio project, and the page reads `useStudioProjects()` | The page renders, but the vault falls back to "Authorized files → Add authorized files", which cannot create a project; the kit exports entries only, with no asset files |
| `013_studio_asset_vault.sql` | `studio_assets`, permissions, approvals, and the private `studio-assets` bucket | No uploads, no vault rows, no ZIP files |
| `016_business_resources.sql` | the independent resource ledger the page writes | The page shows "Independent resource ledger unavailable — Migration 016 is needed to save independent entries. Google viewing and the existing Asset Vault remain available"; no entries, and `business-resources.json` in the kit is empty |
| `003_automation_infrastructure.sql` | **recommended, not decorative**: `automation_settings` holds the monetary budget | `loadBudgets()` returns null, so the paid-call budget cap silently does not exist |


Not needed for this page: 001, 004–011, 014, 015. 016 has no dependency on them; 013 provisions the
bucket itself when the Storage schema exists (proved by the storage-stub test in
`tests/db/migrations.test.ts`), so do not create the bucket by hand — verify it instead.

Steps:

```bash
# One file, one transaction, in order. Each is additive and re-runnable.
# If this project already holds a draft of 017, run rollback/017_..._down.sql first: CREATE TABLE
# IF NOT EXISTS would skip the table and every constraint added to it since that draft.
for f in 002_workspace_model 003_automation_infrastructure 012_studio_brand_intelligence 013_studio_asset_vault 016_business_resources 017_social_research_intelligence; do
  psql "$STAGING_DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 -f "supabase/migrations/$f.sql" || break
done
```

Then, read-only, in the staging SQL editor: `supabase/checks/preflight-001-016.sql` — expect `002/003/012/013/016/017
present`, the rest `missing` (that is correct on this project), the bucket row dumping
`<id>studio-assets</id><public>false</public>` with `file_size_limit` `26214400`, four
`studio_assets_storage_%` policies, and `gaps in the installed chain` = `none` — a gap here would mean a
file you did not intend to apply is present.

Do **not** run `supabase/checks/after-migrations.sql` on this project: rows 1–18 of that check query
004–007 objects (`suppressions`, `consent_records`, `outreach_messages`, `message_policies`, …)
unguarded, so on a 002/003/012/013/016 subset it errors instead of reporting `not applied`. It is the
acceptance check for a full chain, not for this slice. The preflight is guarded throughout — it is tested
on a bare 002 database in `tests/db/migrations.test.ts`.


Auth settings (Dashboard → Authentication): enable the email provider, Site URL
`http://localhost:3000`, redirect URL `http://localhost:3000/auth/callback`, and turn off public sign-up
so only the one invited owner account exists. That account becomes the workspace owner through
`ensure_workspace()` on first sign-in (called in `src/lib/workspace/workspace-provider.tsx`), which is
the only role that may approve files and lift suppressions.

## 4. Minimum app setup, isolated from the working copy

Do not edit the working copy's `.env.local` and do not reuse its `.next` cache:

```bash
git worktree add ../dof-staging-resources feature/google-business-resource-collector
cd ../dof-staging-resources && npm ci          # or symlink node_modules for a throwaway run
```

`.env.local` in that worktree only:

```
NEXT_PUBLIC_SUPABASE_URL=https://<staging-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_<staging>
GOOGLE_PLACES_API_KEY=<staging key, restricted to Places API (New)>
RESOURCE_GOOGLE_ENABLED=true
SIMULATE_EXTERNAL_TOOLS=false
DEMO_SERVER_TOOLS=false
SOCIAL_DISCOVERY_ENABLED=false
PLACES_COST_PER_SEARCH_USD=0.04
PLACES_COST_PER_DETAILS_USD=0.025
PLACES_COST_PER_PHOTO_USD=0.01
BRAVE_SEARCH_API_KEY=
ANTHROPIC_API_KEY=
SUPABASE_SERVICE_ROLE_KEY=
CRON_SECRET=
```

`DEMO_SERVER_TOOLS` must stay `false`: it only matters when Supabase is absent (see `context.ts`), and
`npm run dev` already counts as development mode, so in a cloud staging app it changes nothing — but it
has no business being on in a project that holds real rows. Leave every Brave, Anthropic and
service-role value blank so a stray paid path cannot authenticate.


Google Cloud, before the first click: pin Places API (New) to about 20 requests per day and a $1 budget
alert, as in [LIVE_GOOGLE_RESOURCE_TEST](LIVE_GOOGLE_RESOURCE_TEST.md). Application quotas are fixed in
code — 30 searches, 30 details, 120 photos per workspace per 24 hours (`googleCall()` in
`src/lib/server/resource-collector.ts`) — and they are not a substitute for provider quotas.

Before any click, set the monetary stop: **Automation Center → Controls → Google Places** daily and
monthly limits (`automation_settings.budgets.google_places`), `0.10` and `0.20`. Blank means no limit,
and the windows are the GMT day and month. The reservation per click is
`max(0.05, PLACES_COST_PER_DETAILS_USD)` for details and search, `max(0.01, …_PHOTO_…_)` for a photo, and
the call settles at that same figure, so a `0.20` monthly cap allows exactly four details clicks and
refuses the fifth before it is sent.

Then `npm run dev`, sign in as the owner, fill **Settings → Agency → Agency name (on proposals)**, and add
one prospect (Prospects → Add). Do **not** use the collector's search box: take the Place ID from the free
[Place ID Finder](https://developers.google.com/maps/documentation/places/web-service/place-id) and
paste it into the prospect. That skips the `$0.035`–`0.04` search click entirely and keeps the run to
one details request plus, optionally, one photo.

Sanity check, free: `curl -s http://localhost:3000/api/status` → `"mode": "cloud"` (that one field proves
Supabase is configured, which is what switches simulation off), `"automation": {"outboundSending":
false}`, and no URLs or keys anywhere in the body.

## 5. What the run costs

| Click | Billed (list) | Reserved and settled | Quota |
| --- | --- | --- | --- |
| Details (the listing) | ~$0.025 | $0.05 | 30 / 24 h |
| Photo preview | ~$0.01 | $0.01 | 120 / 24 h |
| Search | ~$0.035–0.04 | $0.05 | 30 / 24 h |
| Website read, vault, ZIP | $0.00 | — | — |

A Place-ID-first run with one photo is therefore about **$0.035** billed and `$0.06` of budget, and
cannot exceed the `0.20` monthly limit or the 30-per-day details quota. Because the ledger settles at the
reserved maximum rather than the invoice, the cap is reached before the spending is: four details clicks
consume the whole month's allowance even though they bill about `$0.10`.

### The four caps, in the order they bite

| Cap | Where it is set | What it stops |
| --- | --- | --- |
| Owner authorisation | this document, §6 | Any second details request or second photo; the run is one details click and at most one photo preview |
| Application budget | Automation Center → Controls → Google Places: daily `0.10`, monthly `0.20` | The fifth details click in a month. Checked **before** the request leaves the app, and it settles at the reserved maximum |
| Application quota | code, `googleCall()`: 30 details, 30 search, 120 photo per workspace per rolling 24 h | A loop, a double click or a replayed request, answered locally with HTTP 429 and no Google call |
| Google Cloud quota and alert | Cloud console: Places API (New) at ~20 requests/day, $1 budget alert | Runaway usage at the provider, including a bug in the application. The quota stops it; the alert tells you |

All four are set before the first click; §4 gives the exact fields, values and windows. Nothing needs
resetting afterwards, because teardown deletes the project.


## 6. The run, in order

The click sequence is [LIVE_GOOGLE_RESOURCE_TEST](LIVE_GOOGLE_RESOURCE_TEST.md) Part C steps 1–7; what
follows repeats it with the staging-only passes added (row-level security, an upload, the ZIP) and the
pass condition for each. Save the evidence as you go.

| # | Do | Pass condition | Keep as evidence |
| --- | --- | --- | --- |
| 6.1 | Open the prospect → **Collect Business Resources**, paste the Place ID, press **Load Google listing** | One details request; address, phone, seven hours and its own Maps link appear, with the unmodified 18px Google Maps logo (`/brand/google-maps-attribution.svg`, accessible name "Google Maps"), its clear space, and the footer links **Terms** · **Privacy** · "Preview only · excluded from downloads"; photo tiles read "Preview photo N" and load nothing. This listing returned no provider-level credits, so that line is genuinely absent — not a bug | Screenshot of the header and footer |
| 6.2 | Read the website row | "Website field: Not supplied — independently verify website status" for this business | Screenshot |
| 6.3 | Preview at most one photo | Image loads from Google's host; author avatar, name and profile link; "View this photo on Google Maps" opens Google's own photo page | Screenshot |
| 6.4 | Press **Save Place ID only**, then reload the page or open a new tab | The Place ID is still in the field; the listing, hours and photo previews are gone because viewer state is component state and was never stored; no Google text or URL is returned from storage | Screenshot |
| 6.5 | Confirm the retention in SQL | `select places_place_id from public.businesses where id = …` returns the ID, and no other Google-derived value exists in any table | Query output |
| 6.6 | Independent entry: add, then revoke | Row appears with source, evidence, `independently_verified` and `export_permission=granted`; revocation keeps history | Query output |
| 6.7 | Upload one owner-authorised file, approve it with export permission | Row in `studio_assets`, object in the private `studio-assets` bucket under the org prefix; a second account outside the org cannot read it | Bucket listing, bucket still private, RLS check |
| 6.8 | Export the Website Resource Kit | ZIP opens; four text/JSON files present; the approved file included once by SHA-256; no Google address, Place ID or `googleusercontent` URL anywhere in the archive | `unzip -l` output and the four files |
| 6.9 | Console → Billing | At most one details SKU line (plus one photo line if 6.3 was clicked); nothing else | Billing line |


## 7. Stop conditions

Same as [LIVE_GOOGLE_RESOURCE_TEST](LIVE_GOOGLE_RESOURCE_TEST.md), plus: any Google name, address,
phone, hours or photo URL appearing in `business_resource_entries`, `studio_assets`, the bucket, the
audit log or the ZIP; a second details request for one click; or the bucket showing `public=true`. On any
of these, set `RESOURCE_GOOGLE_ENABLED=false`, stop, and report — the staging rows are disposable, the
finding is not.

## 8. Teardown

`RESOURCE_GOOGLE_ENABLED=false`; delete the staging Google key (or set its quota to 0); pause the
staging Supabase project; `git worktree remove ../dof-staging-resources`; keep the evidence above with no
listing name, address, phone, hours, photo URLs or bytes in it. The working copy, its `.env.local` and
its commits are untouched by every step.

## 9. Shortest safe path

1. Owner authorises **one** staging run and its two paid clicks (~$0.035).
2. Create a second Supabase project; apply 002, 003, 012, 013, 016 one file per transaction.
3. Run the preflight once; confirm the private bucket, four storage policies and no chain gaps.
4. Add the owner account (invite only), then set **Automation Center → Controls → Google Places** daily
   `0.10` and monthly `0.20`.
5. Create the worktree, fill the staging variables above, keep Brave/Anthropic/service-role blank.
6. Pin the Cloud quota to ~20/day and a $1 alert; take the Place ID from the free Place ID Finder.
7. Run the nine checks in §6, saving each screenshot and query output.
8. Stop conditions first, then teardown.

That is the whole remaining gap: no rebuild of Studio, no concept generation, no second provider, no
production change. Steps 2–4 are unblocked today because they spend nothing; steps 1, 6 and 7 need the
owner's explicit go-ahead because they spend money.
