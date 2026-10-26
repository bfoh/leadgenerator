# Production release gate — environment, budgets, preview, anon grants, go/no-go

Prepared 26 October 2026, after [PRODUCTION_READINESS_AUDIT](PRODUCTION_READINESS_AUDIT.md) §11 was accepted
at `faf72e9`. **Nothing in this document has been executed against Vercel, Supabase or Google.** No push, no
deployment, no paid call, no production row and no schema change. Every command below is either read-only or
marked as needing the owner's explicit approval first.

Candidate: **`faf72e9d48a2f90338a6195c1249bd57f6d861b5`** (code identical to
`b5bc773f214a9db9634aaf63c5a0e3392b36e24b`; `faf72e9` adds only §11 of the audit).

This is the last engineering artefact before the go/no-go. It answers the six release questions in order, and
§8 is the decision table to sign.

| § | Question | Verdict today |
| --- | --- | --- |
| 1 | Are the Production variable names and scopes right, without reading values? | Two names unresolved (`BRAVE_SEARCH_API_KEY`, `GOOGLE_PLACES_API_KEY`), with a names-only procedure and decision rules |
| 2 | Is there a conservative Google Places budget in place? | Not yet — procedure, values, derivation and a zero-cost enforcement proof |
| 3 | The 61-row preflight | Review protocol and acceptance table ready; waiting for your output |
| 4 | An isolated demo-mode Preview from `faf72e9` | Proved locally today (§4.1); deployment steps in §4.3 |
| 5 | The `anon` table-grant gap | Resolved as a reviewed, tested, privileges-only operation (§5), applied only with your approval |
| 6 | Preview steps, release checklist, rollback | §4.3, §6, §7 |

---

## 0. Corrections to §11, found while preparing this

Two statements in §11 are wrong or imprecise. They matter for verification, so they are corrected here rather
than silently edited.

1. **`/api/status` does not report the Supabase project ref.** §11.7 says to "record the project ref the
   deployment reports at `/api/status`". It does not: the handler
   (`src/app/api/status/route.ts:16-40`) returns `mode`, booleans, provider descriptions and quotas, and never
   the URL or key. The project a deployment is bound to is proved by **the `Content-Security-Policy` header**
   (`connect-src` is built from `NEXT_PUBLIC_SUPABASE_URL`, `next.config.ts:6-12,26`) and, for a local build,
   by grepping the build output. §4.4 uses the header.
2. **The chain creates 56 public tables, not 52.** §3's "48 of 52 tables" is stale; §11.3 already records 56
   and the replica returns 56 / 56 with RLS. Only the 56 figure is used below.

A third, smaller finding: the count of policies in the chain is **148** on the built database
(`pg_policies where schemaname = 'public'`), not the 168 that a raw text search of the migration files
suggests. The 148 is the number to compare against in the preflight (§3.2).

---

## 1. Production environment variables: names and scopes, never values

### 1.1 Why names are enough — and where the truth is

A name can exist and still be invisible to the running deployment, because a value is only used when it is in
the **Production** scope of the project the domain is served from. There are three sources of truth, and they
answer different questions:

| Source | Answers | Never shows |
| --- | --- | --- |
| Vercel dashboard → Project → Settings → Environment Variables | the name, the scope tick-boxes (Production / Preview / Development), the last edit | it shows a value only if you click *reveal* — do not |
| `npx vercel env ls production` | the same three columns in the terminal | values are printed as `Encrypted` |
| `https://<domain>/api/status` | whether the **running build** actually saw a value | anything at all — booleans and public policy text only |

The third is decisive. `webSearch.configured` is exactly `Boolean(BRAVE_SEARCH_API_KEY)`
(`src/lib/server/providers/web-search.ts`), and `discovery[0].configured` is exactly
`Boolean(GOOGLE_PLACES_API_KEY)` for the Google provider (`src/lib/server/providers/discovery.ts`). A key that
is "set" in the dashboard but reports `false` at runtime is in the wrong scope, blank, or was added after the
running build was made (server-only values are read at process start; `NEXT_PUBLIC_*` values are inlined at
build time, `src/lib/supabase/config.ts:1-5`).

### 1.2 Read-only commands (safe to run now)

```bash
# One-time link for this machine. Writes .vercel/project.json (project id and org id, no secrets).
npx vercel link

# Names, scopes and dates. The CLI does not decrypt values for this command.
npx vercel env ls production > /tmp/vercel-prod-env.txt
npx vercel env ls preview   > /tmp/vercel-preview-env.txt

# Then check the release names without ever printing a value:
for n in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY NEXT_PUBLIC_SUPABASE_ANON_KEY \
         SUPABASE_SERVICE_ROLE_KEY CRON_SECRET GOOGLE_PLACES_API_KEY RESOURCE_GOOGLE_ENABLED \
         BRAVE_SEARCH_API_KEY SOCIAL_DISCOVERY_ENABLED DEMO_SERVER_TOOLS SIMULATE_EXTERNAL_TOOLS \
         DISCOVERY_SYNTHETIC_PROVIDER ANTHROPIC_API_KEY; do
  if grep -qE "(^|[[:space:]])$n([[:space:]]|$)" /tmp/vercel-prod-env.txt; then echo "present  $n"; else echo "ABSENT   $n"; fi
done
```

Paste that list back. It contains names only, so it is safe to keep with the release record. If your CLI
version prints anything other than `Encrypted` in a value column, delete the file and use the dashboard
instead — do not paste it.

**Do not run**, for this release or afterwards without a reason:

- `npx vercel env pull` — writes every decrypted value to `.env.local`, in a working copy that already points
  at the production project;
- `npx vercel env rm` / `vercel env add` for an existing name — a wrong scope can be fixed additively, a
  removed value cannot be recovered from the dashboard;
- anything with `--sensitive` or `--force` unless you know exactly which name it rewrites.

### 1.3 The name matrix for this release

| Capability | Names that must exist in the **Production** scope | Value that is safe today |
| --- | --- | --- |
| Core app (required) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `NEXT_PUBLIC_SUPABASE_ANON_KEY`) | unchanged |
| Sign-in and worker (in use by the live deployment) | `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` | unchanged |
| Resource Collector | `GOOGLE_PLACES_API_KEY`, `RESOURCE_GOOGLE_ENABLED`; optional `PLACES_COST_PER_SEARCH_USD`, `PLACES_COST_PER_DETAILS_USD`, `PLACES_COST_PER_PHOTO_USD` | key present; **`RESOURCE_GOOGLE_ENABLED=false`** until §2 is complete |
| Social Business Discovery | `BRAVE_SEARCH_API_KEY`, `SOCIAL_DISCOVERY_ENABLED`; optional `DAILY_SOCIAL_DISCOVERY_QUOTA`, `BRAVE_COST_PER_SEARCH_USD` | key missing or blank at the last probe; keep `SOCIAL_DISCOVERY_ENABLED=false` on day one either way |
| AI reports (optional) | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | unchanged; paid work also needs a budget |
| Website Studio | none — deterministic, reads no key | — |
| Must be absent or `false` | `DEMO_SERVER_TOOLS`, `SIMULATE_EXTERNAL_TOOLS`, `DISCOVERY_SYNTHETIC_PROVIDER`, `CREATIVE_DIRECTOR_AI` | absent |

### 1.4 Decision rules for the two names in question

**`BRAVE_SEARCH_API_KEY`** — last probe: `webSearch.configured: false` in Production.

| What the names-only run shows | What it means | What to do before the release |
| --- | --- | --- |
| Present in Production | The value is blank, or the running build predates it | Re-add with `npx vercel env add BRAVE_SEARCH_API_KEY production` (the prompt does not echo the value), then **create a new deployment** — the current one will never see it |
| Present only in Preview/Development | The likeliest cause of R-3 | Add the same value to Production, then a new deployment |
| Absent everywhere | No Brave subscription is wired to this project | Ship without Social Business Discovery: `webSearch.configured: false` and `socialDiscovery.enabled: false` are then the *expected* state and every other feature works |
| Present, and you do not want to pay for Brave yet | A commercial decision, not a defect | Leave the value and keep `SOCIAL_DISCOVERY_ENABLED=false`; nothing calls Brave while the flag is off |

Whichever row applies, **do not enable `SOCIAL_DISCOVERY_ENABLED` for this release.** It costs one paid query
per platform per search (`DAILY_SOCIAL_DISCOVERY_QUOTA` defaults to 20) and has never run against live Brave
on this branch. Enabling it is a later decision with its own budget row.

**`GOOGLE_PLACES_API_KEY`** — presence here does not authorise a call.

| What the names-only run shows | What it means | What to do |
| --- | --- | --- |
| Present in Production | The key is visible to the build | Verify in Google Cloud (§2.5) that it is restricted to **Places API (New)**, has a daily request cap and a budget alert, then apply §2 before setting `RESOURCE_GOOGLE_ENABLED=true` |
| Absent | The collector cannot be enabled at all — `resourceGoogleStatus().enabled` is false without a key, whatever the flag says | Either add the key (then §2.5 and §2) or release with the collector off; the page still renders and reports `enabled: false` |
| Present, `RESOURCE_GOOGLE_ENABLED` absent | The correct default for today | Nothing: the collector stays free and read-only |

`RESOURCE_GOOGLE_ENABLED=true` is a **spending switch**. It is the last step of §2, after the budget read-back,
and needs a new deployment to take effect.

### 1.5 What to send back

Nothing in this section needs a value. Paste:

1. the `present` / `ABSENT` list from §1.2;
2. `curl -s https://<domain>/api/status` (booleans only — it is safe to paste whole);
3. for each of the two names, the row of §1.4 that applies.

That closes R-3 and decides whether the collector can be enabled on release night.

---

## 2. Google Places budgets: set, read back, and prove the stop works for free

### 2.1 What the number is, and where it lives

`automation_settings.budgets` is a jsonb column per organisation, read by every manual paid call
(`src/lib/server/budget.ts:15-22`) and by the automation engine. Shape
(`src/lib/automation/budget.ts:13-15`):

```json
{ "google_places": { "dailyUsd": 5, "monthlyUsd": 60 },
  "brave_search":  { "dailyUsd": null, "monthlyUsd": null },
  "anthropic":     { "dailyUsd": null, "monthlyUsd": null },
  "total":         { "dailyUsd": 15, "monthlyUsd": 150 } }
```

Keys are fixed (`BUDGET_PROVIDERS`, `src/lib/automation/constants.ts:175`); each value is a number or `null`,
`0` allowed. Windows are the calendar day and month in UTC (Ghana time). Spend is the sum of
`usage_records.estimated_cost_usd` since the window opened, with an open paid-call marker counted at its
maximum (`spendByProvider`). The check runs **before** the provider is called: `spent + estimate > cap` throws
429 and no request leaves the server (`checkBudgets`, `src/lib/automation/budget.ts:99-131`).

### 2.2 Conservative starting values, and why

The collector's own ceiling is 30 searches, 30 details and 120 photos per workspace per 24 hours
(`googleCall()`, `src/lib/server/resource-collector.ts`). At the default prices
(`src/lib/server/env.ts:52-57`: search `$0.035`, details `$0.02`, photo `$0.01`) a workspace that maxes every
quota costs:

| Operation | Quota/day | Unit | Worst case/day |
| --- | --- | --- | --- |
| Place Details | 30 | `$0.020` | `$0.60` |
| Search / autocomplete | 30 | `$0.035` | `$1.05` |
| Photo | 120 | `$0.010` | `$1.20` |
| **Total** | | | **`$2.85`** |

So `dailyUsd: 5` allows one full-quota day with headroom and `monthlyUsd: 60` about twenty-one of them, while
the `total` row stops the sum of all providers — the figure Google invoices — from passing `$15/day`.

| Provider | `dailyUsd` | `monthlyUsd` | Rationale |
| --- | --- | --- | --- |
| `google_places` | **5** | **60** | One full-quota day is `$2.85`; a second user or a demo cannot pass `$5` in a day |
| `total` | **15** | **150** | Three times the Places row, so a Brave or Anthropic surprise cannot hide behind it |
| `brave_search` | `null` | `null` | Social discovery stays off; a limit here only matters once it is on |
| `anthropic` | `null` | `null` | AI reports are user-triggered and already governed by the existing daily cap; add a row when they are next used |

Stricter first-week alternative if you would rather be tighter than §11.5: `google_places` `3` / `20`,
`total` `5` / `30`. Both shapes are safe; the stricter one is revisited sooner.

### 2.3 Set it, then read it back

1. Sign in as the workspace **owner** (the Controls tab requires `owner` or `admin`).
2. Automation Center → **Controls** → the budget table (`src/components/automation/controls-tab.tsx:231-266`):
   enter the Google Places and All-providers figures, leave the other rows blank, press **Save budgets**.
3. Read it back, read-only, in the SQL editor:

```sql
select organization_id, budgets, updated_at
  from public.automation_settings
 order by organization_id;                       -- expect one row per workspace, each with google_places + total
```

The saved value must be visible in that column before the flag changes. If the column still reads `{}` for your
workspace, the save did not happen (wrong role, or a different workspace) — stop there.

### 2.4 Prove the stop works, at no cost (recommended before enabling)

The budget is checked **before** the provider call, so a zero cap is a free end-to-end test of the spending
guard:

1. Set `google_places` daily to **`0`** (monthly `0`) and save.
2. Open a prospect → **Collect Business Resources** on a deployment where `RESOURCE_GOOGLE_ENABLED=true`, and
   search for any listing.
3. Expected: an error banner, no results, and
   `Daily Google Places budget reached ($0.000 of $0.000 spent; this step may cost up to $0.035).`
   Nothing reached Google, and `usage_records` gained no `google_places` row.
4. Set the real figures from §2.2 and read back again.

Step 3 failing — results appearing with a `0` cap — means the guard is not live for that workspace, and the
collector must stay off.

### 2.5 Provider-side limits, which the application cannot substitute for

In Google Cloud, on the project that owns the key:

- **API restrictions:** key limited to **Places API (New)** only.
- **Quota:** a per-day request cap in the tens (20–50) until the first real week is observed.
- **Budget and alerts:** a Cloud Billing budget with alerts at `$1`, `$5` and `$25`. Alerts do not stop
  spending; the request cap and the application budget do.

All three are independent and all three should exist: the application budget stops a user, the Cloud quota
stops a bug, the billing alert tells you it happened.

### 2.6 Order of operations

```
budget saved (§2.3) → read-back shows it → zero-cap proof (§2.4) → real values restored
→ RESOURCE_GOOGLE_ENABLED=true → new deployment → one user-initiated lookup
→ read usage_records → record the numbers
```

The R-6 caveat still holds: with **no** budget row, `enforceBudget` returns immediately
(`src/lib/server/budget.ts:60`) and the only limit is the 30/30/120 per-organisation quota, which is a count,
not a price. An empty `budgets` column is therefore not a conservative setting; it is the absence of one.

---

## 3. Reviewing your 61-row preflight output

### 3.1 How to produce it

`supabase/checks/preflight-001-016.sql`, pasted whole into the Supabase SQL editor as a workspace owner. It is
one statement, it opens no transaction and writes nothing — `tests/db/migrations.test.ts` runs it twice inside
`begin transaction read only` and asserts the statement count is one, so the editor shows a table rather than
"Success".

Copy the result as CSV (or paste the three columns as text) and keep it with the release record. **Nothing in
it is a secret**: it reports object names, counts, settings and the connected role. It does not read business
names, addresses, phones, emails or message bodies.

### 3.2 The reference output, from a clean 001–016 replica

The same file, executed on the PGlite full-chain replica today: **61 rows, exactly** — 16 chain, 9 database,
16 objects, 2 storage, 12 records, 3 impact, 3 gates. Diff yours against each block below.

**Must match, or the release stops:**

```text
chain     001 private leads … 016 business resources        present ×16
gates     002 baseline present                              yes
gates     gaps in the installed chain                       none
gates     next file to apply                                none - chain complete
impact    files still to apply                              0
database  Supabase Storage schema                           present    (replica: absent, no Storage in PGlite)
database  can create objects in public                      yes
database  connected as                                      postgres (effective role postgres)
database  requests or transactions running over 5 minutes    0
records   approved or sent proposals without an approval time  0
records   signed-up users without a workspace               0
```

**The `objects` block must match line for line** (RLS state · policies · triggers). Note `consent_records`
carries 3 triggers and `businesses` 8; a smaller number is a missing guard, not a tidier schema.

```text
audit_events                    RLS on · 1 policies · 0 triggers
business_resource_entries       RLS on · 3 policies · 2 triggers
businesses                      RLS on · 4 policies · 8 triggers
consent_records                 RLS on · 2 policies · 3 triggers
discovery_runs                  RLS on · 1 policies · 0 triggers
ghana_districts                 RLS on · 1 policies · 0 triggers
message_policies                RLS on · 3 policies · 3 triggers
organization_members            RLS on · 3 policies · 1 triggers
organizations                   RLS on · 3 policies · 2 triggers
studio_assets                   RLS on · 4 policies · 2 triggers
studio_brand_kits               RLS on · 4 policies · 2 triggers
studio_creative_directions      RLS on · 2 policies · 1 triggers
studio_projects                 RLS on · 4 policies · 3 triggers
studio_website_prototypes       RLS on · 2 policies · 1 triggers
suppressions                    RLS on · 3 policies · 2 triggers
usage_records                   RLS on · 2 policies · 0 triggers
```

**Storage — the replica cannot show these, and production must:**

```text
storage   studio-assets bucket           <id>studio-assets</id> … <public>false</public> … <file_size_limit>26214400</file_size_limit>
storage   studio-assets object policies  4
```

If either storage row says "Storage absent" on production, that is a stop condition (§3.3): 013 skipped the
bucket, so the Asset Vault has nowhere to put a file.

**Expected to differ — record, do not act:** `database` version, size, other sessions, CLI history table,
`pg_cron and pg_net`; every `records` count that reflects live data (`businesses`, `organizations`,
`audit events`, `usage records this month`, `proposals by status`, `members by role`, `open tasks`,
`website verifications`, `businesses opted out`); both `impact` rows. `businesses carrying place IDs` must be 0
until the collector has been used, and explainable afterwards.

### 3.3 Stop conditions — do not promote if any of these appear

| Finding | Why it stops the release |
| --- | --- |
| Any `chain` row other than `present` | R-1 again: the deployed code would expect an object that is not there |
| `gaps in the installed chain` other than `none` | An object exists without its earlier dependencies — the shape that needed the 008/010 repair |
| `Supabase Storage schema` = `absent`, or a storage row saying "Storage absent" | No Asset Vault: uploads, approvals and the ZIP fail even though the pages render |
| `studio-assets object policies` ≠ `4`, or `<public>true</public>` | Asset bytes are reachable by anyone holding a URL |
| Any object row with `RLS off` or `0 policies` | Tenant isolation is broken |
| `requests … over 5 minutes` ≠ `0` | You are inspecting a schema under a long transaction |
| `connected as` anything but `postgres`/owner | The run may be filtered by RLS and will under-report |

### 3.4 Four extra read-only statements to send with it

```sql
-- 1. 56 tables, RLS on all of them, none without a policy.
select count(*) as public_tables, count(*) filter (where relrowsecurity) as rls_on,
       count(*) filter (where not relrowsecurity) as rls_off
  from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r';   -- expect 56 | 56 | 0

select c.relname from pg_class c
 where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
   and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname);
                                                                                 -- expect 0 rows

-- 2. Policy count and the anon surface (the input to §5).
select count(*) as policies, count(*) filter (where 'anon' = any(roles)) as policies_admitting_anon
  from pg_policies where schemaname = 'public';                                  -- expect 148 | 0

select grantee, count(*) as tables
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role')
 group by grantee order by grantee;                                             -- anon: 6 tables before §5

-- 3. The bucket itself.
select id, public, file_size_limit, allowed_mime_types
  from storage.buckets where id = 'studio-assets';                              -- public = false, 26214400

-- 4. The reference data the CRM depends on.
select count(*) as regions from public.ghana_regions;                           -- 16
select count(*) as districts, count(distinct region) as regions_used,
       count(*) filter (where region is null or btrim(region) = '') as empty_region
  from public.ghana_districts;                                                  -- 261 | 16 | 0
```

### 3.5 How the review is recorded

Your output is compared row by row against §3.2, and each divergence is classified as *must match* (stops the
release), *expected difference* (live counts, sizes, versions) or *unexplained* (needs one more query before it
can be cleared). The verdict and your pasted output are appended here as §3.6, and that appendix — not this
protocol — is what §8's go/no-go refers to.

### 3.6 Verdict on the production preflight

**Awaiting the owner's output.** Nothing has been reviewed yet, so the release is not cleared on this item.

---

## 4. An isolated demo-mode Preview from `faf72e9`

### 4.1 What was proved locally today (no deployment, no network)

`git archive faf72e9 | tar -x -C /tmp/dof-preview-faf72e9` — a throwaway copy of the candidate with **no
`.env.local`** (only `.env.example`), so nothing from this working copy could leak in. Thirteen variables were
then set to the empty string in the shell before building, so each was present-and-blank rather than absent:

```bash
env NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY= NEXT_PUBLIC_SUPABASE_ANON_KEY= \
    SUPABASE_SERVICE_ROLE_KEY= GOOGLE_PLACES_API_KEY= BRAVE_SEARCH_API_KEY= ANTHROPIC_API_KEY= \
    CRON_SECRET= RESOURCE_GOOGLE_ENABLED= SOCIAL_DISCOVERY_ENABLED= DEMO_SERVER_TOOLS= \
    SIMULATE_EXTERNAL_TOOLS= DISCOVERY_SYNTHETIC_PROVIDER= npm run build
npx next start -p 3311        # same environment
```

| Check | Result |
| --- | --- |
| `npm run build` | `✓ Compiled successfully in 41s`, 23 static pages generated, the full route table printed |
| `check-client-bundle.mjs` | `179 files checked for 5 key formats, service-role tokens and 0 configured secret values; no matches` |
| `GET /api/status` | `mode: "demo"`, `serverTools: false`, `ai.configured: false`, `webSearch.configured: false`, Google discovery `configured: false`, `socialDiscovery.enabled: false` and `liveEnabled: false`, `automation.backgroundWorker: false`, `contacts.providers: []` |
| `GET /login` headers | `Content-Security-Policy: … connect-src 'self'; …` — **no Supabase origin**, so the page cannot reach any project |
| `GET /api/resources` | `403 {"error":"Server tools are disabled on public demo deployments. …"}` |
| `GET /api/messaging/status` | `403`, same message — no outbound path in demo mode |
| `GET /api/cron/automation` | `503 {"error":"The background worker is not configured."}` — no service-role key, so the worker cannot run |
| `GET /` and `GET /login` | `200` |
| production project ref in `.next/server` + `.next/static` | **0 files** |
| `supabase.co` in the build | 439 hits, all inside `.js.map` files and all `https://supabase.com/docs/…` documentation links in library comments — not a project URL. Worth knowing before anyone greps for it and panics |

That is the isolation proof in executable form: a demo-mode build has no database to write to, no key to spend
with, no worker to start and a CSP that will not let the browser try.

### 4.2 The Preview scope must be blank, not inherited

Vercel applies an environment's variables **at build time** for `NEXT_PUBLIC_*` values and at start-up for
server values. If the Preview scope inherits production's values — the default when a variable is created for
"all environments" — the preview is production (R-5). Set these in Project → Settings → Environment Variables,
ticking **Preview only**, with an empty value:

| Name | Preview value | Why |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | *(blank)* | Inlined at build; a blank value is what makes `mode: "demo"` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | *(blank)* | Same |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | *(blank)* | Same; leave whichever of the two you do not use absent |
| `SUPABASE_SERVICE_ROLE_KEY` | *(blank)* | Without it the cron route answers 503 and cannot write |
| `CRON_SECRET` | *(blank)* | No secret, no worker call even if a key leaked in |
| `GOOGLE_PLACES_API_KEY` | *(blank)* | No paid call is possible, and `googleCall()` refuses demo mode anyway |
| `BRAVE_SEARCH_API_KEY` | *(blank)* | Same for Social Business Discovery |
| `ANTHROPIC_API_KEY` | *(blank)* | Same for AI reports |
| `RESOURCE_GOOGLE_ENABLED` | `false` (or absent) | Belt and braces: the flag alone cannot spend |
| `SOCIAL_DISCOVERY_ENABLED` | `false` (or absent) | Ditto |
| `DEMO_SERVER_TOOLS` | `false` (or absent) | `true` would re-enable server tools on a public URL |
| `SIMULATE_EXTERNAL_TOOLS` | `false` (or absent) | Test-only switch; no business in a preview |
| `DISCOVERY_SYNTHETIC_PROVIDER` | `false` (or absent) | Never in a shared preview |

Leaving these blank **permanently** is the best outcome: every future preview is demo-mode by construction, and
nothing has to be remembered on release night. The cost is that a preview can never show a live Google listing
— that needs the second Supabase project in [STAGING_RESOURCE_COLLECTOR](STAGING_RESOURCE_COLLECTOR.md) §3–§4,
which is a separate authorisation.

### 4.3 Two ways to deploy it

**Route A — no push at all (recommended, and it needs no branch on the remote):**

```bash
# 1. A clean copy of the candidate: no .env.local, no .next, no node_modules.
rm -rf /tmp/dof-preview-faf72e9 && mkdir -p /tmp/dof-preview-faf72e9
git archive faf72e9 | tar -x -C /tmp/dof-preview-faf72e9

# 2. Link that directory to the existing project (writes .vercel/project.json; .vercel is gitignored).
cd /tmp/dof-preview-faf72e9 && npx vercel link --yes

# 3. A preview deployment. No --prod. Vercel builds it remotely and reads the Preview scope itself,
#    so no secret is ever written to this machine.
npx vercel deploy

# 4. Record the deployment URL it prints, and its id (`npx vercel ls`).
```

The CLI may note that the directory is not a git repository. That is expected with `git archive`, and it is a
feature here: the artefact is byte-identical to `faf72e9` regardless of the state of any branch.

**Route B — push the branch and let the Git integration build the preview.** Needs your approval first,
because it publishes 25 commits to the remote:

```bash
git push -u origin feature/google-business-resource-collector    # approval required
```

A connected project then builds a preview for the branch automatically. The difference that matters: with
Route B the preview is built from whatever is on the remote, so the commit shown in the deployment must be
checked to be `faf72e9` (or a later documentation-only commit) before it is trusted for sign-off.

**Do not** build with `--prebuilt` for this preview: that requires the Preview values on this machine, which
means `vercel env pull`, which writes production secrets into the working copy.

### 4.4 Six checks on the deployment, before anyone opens a page

```bash
BASE=https://<preview-url>

curl -s  "$BASE/api/status" | grep -o '"mode":"[a-z]*"'                 # "mode":"demo"
curl -s  "$BASE/api/status" | grep -o '"webSearch":{[^}]*}'             # "configured":false
curl -sI "$BASE/login" | grep -i content-security-policy                # connect-src 'self'  (no supabase.co)
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/api/resources"          # 403
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/api/cron/automation"    # 503
curl -s  "$BASE/api/status" | grep -c 'supabase.co'                     # 0
```

| Check | Pass | If it fails |
| --- | --- | --- |
| `mode` | `demo` | A Supabase value reached the Preview scope or the build. Stop; do not open a page that writes |
| `connect-src` | ends at `'self'` | The browser is allowed to reach a Supabase project — the preview is not isolated |
| `/api/resources` | `403` | Server tools are enabled on a public URL: `DEMO_SERVER_TOOLS` or Supabase is set |
| `/api/cron/automation` | `503` | A service-role key reached Preview: the worker could write |
| `webSearch.configured` | `false` | A Brave key reached Preview (harmless for spend while the flag is off, but it is a scope leak) |

If every line passes, the preview is safe to click through: every page renders from browser storage, and the
"Demo" label is truthful.

### 4.5 Protection and teardown

- Turn on **Deployment Protection → Vercel Authentication → Standard Protection**, so preview URLs are not
  publicly reachable. If your plan does not offer it, treat the URL as public: demo-mode pages hold no real
  data, but the URL should not be circulated.
- Do not add `CRON_SECRET` or a service-role key to the Preview scope "just to test the worker". That converts
  a read-only preview into a writer.
- Teardown is `npx vercel remove <deployment-url>` (or the dashboard's Delete). Keep the blank Preview values
  in place afterwards — they are the guard rail for the next preview.

---

## 5. The `anon` table-grant gap (R-4): closed by a privilege revoke, not a migration

### 5.1 What is actually open

Six tables created by 014–016 still carry table-level privileges for the `anon` role, because those three
migrations never revoke them and Supabase's default privileges grant `anon` everything on new tables in
`public`:

`studio_creative_briefs`, `studio_creative_brief_reviews`, `studio_creative_directions`,
`studio_creative_direction_reviews`, `studio_website_prototypes`, `business_resource_entries`.

**Nothing is readable through them.** Every policy in the chain is `to authenticated` — measured on the replica:
**148 policies in `public`, 0 of which admit `anon`** — and a request without a session is evaluated as `anon`,
which no policy admits. So this is a capability that should not exist, not a leak that did.

It is worth closing anyway, for one reason: the only thing standing between the grant and a real exposure is
that nobody adds a permissive policy by mistake. Removing the grant means a future mistake has to add *both*.

### 5.2 The decision, and the recommendation

| Option | Effect | Risk |
| --- | --- | --- |
| **A. Apply §5.3 during the release window** (recommended) | `anon` holds no table privileges anywhere in `public`; recurrence prevented via default privileges | One statement, privileges only, re-runnable, instantly reversible, no deploy, no downtime |
| B. Apply after the release | Same end state, a day later | The gap survives a release that was otherwise declared clean |
| C. Accept and document | Nothing changes | A documented, non-exploitable anomaly stays in the security record indefinitely |

Recommendation: **A**, as step 0 of the release window (§6), before the code is promoted. It does not touch
`authenticated`, the policies, the data, or anything the application calls, and it can be verified in the same
SQL editor session that applies it.

### 5.3 The statement (tested today, verbatim)

Paste into the Supabase SQL editor as `postgres`, in one run:

```sql
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon';
    execute 'revoke all on all sequences in schema public from anon';
    execute 'alter default privileges in schema public revoke all on tables from anon';
    execute 'alter default privileges in schema public revoke all on sequences from anon';
  end if;
end $$;
```

Why each line:

- `revoke all on all tables in schema public from anon` — covers every table, view and materialised view,
  including the six, in one statement. It is broader than the six on purpose: no table in `public` has a policy
  that admits `anon`, so a narrower list would only have to be extended later.
- `revoke all on all sequences …` — sequences grant nothing on their own, but a leftover `usage` grant is the
  same class of residue.
- `alter default privileges … revoke … from anon` — removes the default that created the gap, so a future
  migration by `postgres` cannot reintroduce it.
- The `pg_roles` guard makes it safe on a database without an `anon` role (a local Postgres, a test harness).

**Evidence, on the 001–016 chain in PGlite** (`createDatabase()`, with Supabase's default privileges reproduced
by `grant all on all tables in schema public to anon` — a superset of production's six tables):

| Measure | Before | After |
| --- | --- | --- |
| `anon` table grants in `public` | 392 (56 tables × 7) | **0** |
| `authenticated` table grants | 151 | **151** (unchanged) |
| policies in `public` | 148 | **148** (unchanged) |
| tables with RLS on | 56 | **56** (unchanged) |
| `ghana_regions` / `ghana_districts` rows | 16 / 261 | **16 / 261** (unchanged) |
| a table created afterwards, `has_table_privilege('anon', …, 'select')` | true | **false** |
| second run of the statement | — | no error, still 0 |

Production's starting figure is smaller: 6 tables, not 56. Expect `anon: 6` in §3.4's grant query before the
statement, and no `anon` row at all after it.

### 5.4 Verify it in the same session

```sql
-- Before: six tables, each with the full privilege set.
select table_name, string_agg(privilege_type, ',' order by privilege_type) as privileges
  from information_schema.role_table_grants
 where grantee = 'anon' and table_schema = 'public'
 group by table_name order by table_name;

-- After: no rows.
select count(*) as anon_grants
  from information_schema.role_table_grants
 where grantee = 'anon' and table_schema = 'public';            -- expect 0

-- And the application's own role is untouched:
select count(*) as authenticated_grants
  from information_schema.role_table_grants
 where grantee = 'authenticated' and table_schema = 'public';   -- the same as before (151 on the replica)

select count(*) as policies, count(*) filter (where 'anon' = any(roles)) as anon_policies
  from pg_policies where schemaname = 'public';                 -- expect 148 | 0
```

Then sign in and open one Studio page and one prospect. A `permission denied for table …` there would mean
something *was* relying on the `anon` grant: run §5.5 immediately and report it, because that would be a real
finding, not a cleanup.

### 5.5 Reversal, and why you should not need it

```sql
-- Only to undo §5.3. Nothing in this release needs it.
grant select, insert, update, delete on all tables in schema public to anon;
alter default privileges in schema public grant select, insert, update, delete on tables to anon;
```

Reversible in one statement because it is privileges only: no data to restore, no schema to rebuild, no backup
to take. That is exactly why it is safe to run in a release window, and why a rollback *migration* would not be.

### 5.6 Why this is not a numbered migration today

Adding `017_…sql` to `supabase/migrations/` would change four things beyond the fix, all of them worse than the
problem:

1. `tests/db/migrations.test.ts` derives `files still to apply` from `preflight-001-016.sql`'s own list and
   asserts it equals the number of migration files — a 17th file fails that test until the preflight is
   extended, which turns the **61-row artefact you are about to sign off** into a 62+-row one.
2. The rollback folder must mirror the migration list exactly, so a new pair means another down script to
   review, test and remember.
3. It would leave the repository one migration ahead of production on release night — the asymmetry (R-1) that
   cost 008 and 010 a separate repair.
4. It would move the release candidate past `faf72e9`, the commit this gate and the preview refer to.

So the fix ships as an **operation**, recorded here with its evidence. When the chain next changes for a real
reason, fold §5.3 into that migration and add the preflight row then — pair, test and check in one reviewed
change.

### 5.7 What "resolved" means at go/no-go

Resolved when the §5.4 queries return `anon_grants = 0` and `authenticated_grants` unchanged on production, and
the Studio and prospect pages still open. Until then this item is **prepared, not closed**, and §8 records it
that way.

---

## 6. The release, step by step

Each step names what stops the release. ⛔ marks a step that needs your explicit approval before it runs —
everything else is read-only or already covered by the approval that opened the window.

**Step 0 — open the window.** ⛔ Your message "release approved" with the candidate hash. Take a Supabase backup
first (Dashboard → Database → Backups, or [BACKUPS](BACKUPS.md) §2), and note the current production deployment
URL and id (`npx vercel ls --prod`) — that id is the whole application rollback (§7.2).

**Step 1 — confirm the candidate.**

```bash
git status --porcelain          # expect empty
git rev-parse HEAD              # expect faf72e9… plus this document's commit
```

Only documentation may differ from `faf72e9`. If code differs, stop: the release is no longer the thing that was
tested.

**Step 2 — preflight on production.** Run §3.1 and §3.4, send the output; the verdict is appended as §3.6.
Stops the release: any row in §3.3.

**Step 3 — close the `anon` grant (recommended).** §5.3, then §5.4, then open one Studio page and one prospect.
Stops the release: `anon_grants` not `0`, `authenticated_grants` changed, or a page denied.

**Step 4 — names and scopes.** §1.2 and the Production `/api/status`. Record `webSearch.configured` and the
Google discovery `configured` boolean. Stops the release: a core name missing (`NEXT_PUBLIC_SUPABASE_URL`, the
publishable key, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`) — sign-in or the worker would break.

**Step 5 — budget.** §2.3 saved and read back. Stops the release *of the collector*, not of the app, if it is
missing — but it must be done before step 12 whatever else happens.

**Step 6 — provider limits.** §2.5 confirmed in Google Cloud: key restricted to Places API (New), daily cap,
billing alerts.

**Step 7 — preview.** §4.3 Route A, the six checks in §4.4, then you click through the demo build in a real
browser, phone width included — the collector and Studio pages are what changed. Stops the release: a failing
check, or a page that renders against a real project.

**Step 8 — go/no-go.** Fill in §8. No signature, no deploy.

**Step 9 — publish the code.** ⛔ Either

```bash
git push -u origin feature/google-business-resource-collector   # a preview builds on the remote
git checkout main
git merge --ff-only feature/google-business-resource-collector  # fast-forward only, as §11.8 states
git push origin main                                            # production builds
```

or keep the branch unpushed and deploy the checked artefact directly (step 10). The first publishes the branch's
25 commits plus this document's; the second publishes nothing to git and produces the same production build.
Both are reversible, your call.

**Step 10 — production deployment.** ⛔ Either promote the preview from step 7 (`npx vercel promote <url>`, or
dashboard → Deployments → the preview → Promote to Production), or deploy the same commit:

```bash
npx vercel deploy --prod
```

Record the new deployment URL and id; keep the previous id from step 0 next to it.

**Step 11 — post-deploy smoke, no paid calls** ([DEPLOYMENT](DEPLOYMENT.md) §6, plus the 2026 checks):

```bash
curl -s  https://<domain>/api/status | head -c 400     # mode "cloud", automation.backgroundWorker true
curl -s -o /dev/null -w '%{http_code}\n' https://<domain>/api/cron/automation   # 401 (worker configured, no secret)
curl -sI https://<domain>/login | grep -iE 'content-security-policy|strict-transport|x-frame'
```

Then in the browser: magic-link sign-in, Overview, one prospect, Automation Center → Overview, Analytics,
Settings → Team. Stops the release: a 500, a `request_error` in the host log, or a page reporting "database
update required" (which would mean step 2 was wrong).

**Step 12 — enable the collector, last.** ⛔ Only after steps 5 and 6:

```bash
npx vercel env add RESOURCE_GOOGLE_ENABLED production      # value: true
npx vercel deploy --prod                                   # an env change needs a new deployment
```

If the zero-cap proof (§2.4) has not been run, run it now: a `0` cap and one search costs nothing and proves the
guard. Then restore the real budget and make exactly **one** user-initiated lookup on a real prospect. Read the
ledger:

```sql
select provider, operation, estimated_cost_usd, metadata, created_at
  from public.usage_records
 where provider = 'google_places' order by created_at desc limit 20;   -- one or two rows, expected cost, no content
```

Stops the rollout: more requests than you clicked, a cost above the estimate, or a Google field stored in any row.

**Step 13 — record and close.** Append to §3.6 and §8: preflight output, `/api/status` before and after, budget
read-back, deployment ids, the one lookup's usage row. Only then is the release closed.

**Step 14 — first 24 hours.** Read `usage_records`, the host's `request_error` events and the budget spend once.
Nothing else is scheduled: `SOCIAL_DISCOVERY_ENABLED` is still off and automation defaults to Research only.

**Not part of this release:** enabling Social Business Discovery or Brave, enabling messaging, publishing any
showcase (Adwoa's House awaits your creative approval), and any Studio redesign.

---

## 7. Rollback

### 7.1 Three kill switches, fastest first

| # | Action | Takes effect | Leaves unfixed |
| --- | --- | --- | --- |
| 1 | **Google Cloud → the key → disable it** (or set the Places quota to 0) | immediately, no deploy | the app, which shows a provider error until the flag is off |
| 2 | **Automation Center → Controls → `google_places` daily and monthly `0` → Save** | immediately, next request: `enforceBudget` reads the row per call | a request already in flight |
| 3 | `npx vercel env add RESOURCE_GOOGLE_ENABLED production` = `false`, then `npx vercel deploy --prod` | at the new deployment (~2 min) | nothing — this is the clean, documented stop |

Use 1 or 2 when money is leaving and it must stop *now*; use 3 to leave the system in a state you can explain.
All three leave the data untouched.

### 7.2 Application rollback

```bash
npx vercel ls --prod                            # find the deployment from before the release (step 0)
npx vercel promote <previous-deployment-url>    # or dashboard → Deployments → … → Promote to Production
```

Then confirm the promotion took: `/api/status` returns the older shape (for example `socialDiscovery` absent, and
`automation.backgroundWorker` matching the older build). The database needs **nothing** — every migration in the
chain is additive and the previous build works against 001–016, which is why §11.9 says to promote rather than to
run down files.

### 7.3 Database

- **Do not run any rollback file for a code rollback.** `supabase/rollback/*_down.sql` deletes tables and data,
  and the app does not need it. 010's down file also refuses while any business holds a district code without a
  town.
- The only database change this release makes is §5.3, privileges only. Its reversal is §5.5, and the expected
  need for it is zero.
- Never `supabase db push` without first recording how 008 and 010 were applied:
  `supabase migration repair --status applied 008 010`. The CLI is still not installed here and
  `supabase/config.toml` does not exist.

### 7.4 Worker and queue

If a bad deploy ran the worker: Automation Center → Controls → **pause** the workspace (the pause flag is read
before any job is claimed), then inspect `automation_jobs` by status and `agent_runs` for the failed ids. Pausing
is per workspace and does not touch the queue's contents.

### 7.5 What to record either way

Deployment ids (new and previous), the `/api/status` body before and after, the `usage_records` rows created
during the window, and the preflight output. If anything above was used, write it up per
[INCIDENT_RESPONSE](INCIDENT_RESPONSE.md) — including a rollback that worked, because a promotion nobody recorded
is the next release's surprise.

---

## 8. Go/no-go

Sign the right-hand column. **No signature, no deploy** — and §6 step 9 stays blocked until every line is either
signed or explicitly waived.

| # | Item | Evidence | Status today | Owner |
| --- | --- | --- | --- | --- |
| 1 | 008 and 010 in production | §11.2–11.3, the five TRUE checks | **closed** | — |
| 2 | Production preflight, 61 rows | §3.6 | **awaiting your output** | ☐ |
| 3 | `anon` grants closed | §5.4 `anon_grants = 0`, authenticated unchanged | **prepared, not applied** | ☐ |
| 4 | Production env names and scopes | §1.2 list + `/api/status` | **awaiting your run** | ☐ |
| 5 | Google Places budget set and proved | §2.3 read-back, §2.4 zero-cap proof | **not yet set** | ☐ |
| 6 | Google Cloud key restriction, quota, alert | §2.5 | **unverified** | ☐ |
| 7 | Demo-mode preview passes six checks | §4.1 local proof, §4.4 on the deployment | **local: pass; deployed: not yet** | ☐ |
| 8 | Release suite green on the candidate | §11.6: 931 tests, tsc, lint, build, bundle scan | **closed** (code unchanged since) | — |
| 9 | Rollback rehearsed: previous deployment id captured | §6 step 0, §7.2 | **not yet captured** | ☐ |
| 10 | Adwoa's House creative approval | [ACTIVE_CREATIVE_HANDOFF](ACTIVE_CREATIVE_HANDOFF.md) | **pending — independent of this release**; Studio ships with `publishReady: false` | ☐ |
| 11 | Paid spend authorised | §6 step 12 | **not authorised** | ☐ |

**Go** means items 1–9 are signed and 11 is authorised for one lookup. Item 10 is not a gate for shipping the
Studio; it is a gate for *publishing* a showcase, which this release does not do.

---

## 9. Evidence index — what to keep with the release record

| Artefact | Produced by | Where it lives |
| --- | --- | --- |
| 61-row preflight + the four extra queries | §3.1, §3.4 | §3.6, pasted |
| Names-only env list, `/api/status` before and after | §1.2, §6 step 4/11 | §8, pasted |
| Budget JSON read-back | §2.3 | §8 |
| Preview URL, its six check outputs, its commit | §4.3–4.4 | §8 |
| Deployment ids (new and previous) | §6 step 0/10 | §8 |
| The one `usage_records` row | §6 step 12 | §8 |
| Local isolation proof (build, demo status, CSP, 403/503, ref grep) | §4.1 | this document |

Nothing in that list contains a secret, a business's details or a Google-derived field. That is deliberate: the
release record has to be safe to keep.
