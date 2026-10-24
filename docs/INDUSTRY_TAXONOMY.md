# Industry taxonomy (Milestone 3A, quality pass 3A.1)

The catalogue behind Discover, Prospects, research campaigns, report packs and proposal templates.
It is a plain constant: `businesses.category` is `text` (1–80 characters), so no migration is needed
to add a category. **Nothing here changes the database schema.**

## Counts

| What | Before | Now |
| --- | --- | --- |
| Categories (`DEFAULT_CATEGORIES`) | 20 | **388** |
| Industry groups | – | **30** |
| Sector tracks (`TRACKS`) | 15 | **29** (14 new) |
| Solution-library archetypes | 9 | **22** (13 new) |
| Verified Google Places Table A types available | – | **159** (curated subset of Google's Table A) |
| Categories with a reference Places type | – | **243** |
| Reference types actually sent as a filter | – | **127** (reviewed; see below) |

All 20 original labels are preserved **verbatim** and still resolve to their original track, so every
saved prospect, report pack and proposal keeps working. `LEGACY_CATEGORY_LABELS` lists them and
`tests/unit/taxonomy.test.ts` asserts the mapping.

## Where things live

| File | Role |
| --- | --- |
| `src/lib/domain/places-types.ts` | The verified Places API (New) **Table A** allowlist, copied from Google's documentation. A type outside this list cannot compile. |
| `src/lib/domain/industry-taxonomy.ts` | `INDUSTRY_GROUPS` (30) and `INDUSTRY_CATEGORIES` (388) with `id`, `label`, `group`, `track`, `searchTerm`, `placesTypes`, `aliases`; lookups by label, id and group. |
| `src/lib/domain/categories.ts` | Historic public API: `DEFAULT_CATEGORIES`, `trackForCategory`, `searchTermForCategory`, `TRACKS`, plus `groupCategoryLabels` and `placesTypeForCategory`. |
| `src/lib/domain/places-filters.ts` | The reviewed `includedType` pairs (127), and the reason each remaining mapped category is searched by phrase instead. |
| `src/lib/domain/industry-compliance.ts` | Which activities need a licence before trading (and which are out of scope altogether), plus the standing proposal assumption. |
| `src/components/discover/category-selector.tsx` | Searchable, grouped picker used by Discover (native selects, so phone pickers and screen readers work without custom ARIA). |
| `src/components/automation/industry-scope-picker.tsx` | Grouped campaign targeting with the 50-entry cap. |
| `src/components/settings/scoring-tab.tsx` | Focus categories, grouped and searchable (capped at 100). |

## Rules

1. **A label never changes meaning.** `businesses.category` stores the label, so renaming one silently
   re-files real prospects. Add a new label instead.
2. **`id` is derived** from the label (slug). Use it when a reference must not contain spaces.
3. **`placesTypes` only names verified Table A types** from `places-types.ts`. An empty list is
   correct when Google has no honest match — the text phrase is the fallback.
4. **`searchTerm` is a search phrase, not a claim.** It is what Discover sends when nobody typed
   custom terms.
5. **One category belongs to exactly one group**; a group is a browsing and targeting aid, not a
   second parent.
6. **`aliases` are for finding a category in a picker**, not for provider queries (e.g. `waakye`,
   `trotro`, `susu`, `kente`). Unlawful activities are never aliases: “galamsey” is not attached to
   small-scale mining, because only licensed operations are in scope.

## Group-level targeting

A group label is a valid value anywhere a category is accepted:

- **Discover** — “All *X* industries” in the picker searches the group's phrase and files a tracked
  business under the group label; `trackForCategory` resolves it to the group's track.
- **Campaigns** — a group entry matches every prospect in that group, including categories added
  later. This matters because `campaigns.scope.categories` is capped at 50 entries (migration 009);
  30 group entries cover the whole catalogue. A *category* entry stays exact.

## Google Places mapping

`placesTypes` in the taxonomy is a **reference**: it records the Table A type that best describes a
category. It is not automatically sent. `placesIncludedType()` sends `includedType` only when all of
these hold:

1. the category is one of the **127 reviewed pairs** in `places-filters.ts`;
2. the researcher did not type custom terms; and
3. the request is a category search, not a whole-group search.

Every other category is searched by phrase. The text query is **always** sent, so a phrase-only
search still finds the business. The audit removed three kinds of unintended exclusion:

- **Venue types**: `market` is a market building, not the traders inside it (`Market trader`,
  `Fishmonger`, `Hawker & itinerant trader`); `bus_station` is a place, not a transport operator;
  `flea_market` is not a second-hand trader.
- **Narrow trade tags**: `meal_takeaway` misses street vendors; `clinic` misses facilities tagged
  `doctor` or `medical_center`; `snack_bar` misses many waakye and kenkey joints; `school` misses
  short-course training providers.
- **Generic relations**: `supplier` and `consultant` are not business kinds and return unrelated
  places; `manufacturer` misses micro-processors and print shops.

`placesFilterReason(label)` returns the specific reason for a category that names a reference type but
is searched by phrase; `tests/unit/taxonomy.test.ts` asserts that every mapped category is either a
reviewed filter or has a reason. Group searches (`Food, Drink & Catering`) never send a type.

## Analytics rollups

`industryRollup()` in `src/lib/domain/analytics.ts` reports all **30 groups**, including groups with no
records, and keeps the exact stored labels underneath each one:

| Measure | Meaning |
| --- | --- |
| Records | All prospects ever filed in the group, including lost and archived ones. |
| Open | `isOpenStage` records as they stand now. |
| Qualified | Open records scoring **50 or more** — the same threshold campaigns use. |
| Won | Records whose furthest reached stage is `won`, from the current stage and logged stage changes. A record lost after winning still counts. |
| Proposals accepted / decided | Proposals in `accepted` or `declined` state, lifetime. |
| Conversion | Won ÷ records; proposal win rate is accepted ÷ decided. |
| Average score | Mean opportunity score of open, scored records. |

Labels outside the catalogue (workspace categories such as “Mammy wagon transport”) appear in a
separate **Not in the catalogue** bucket, so group totals always reconcile with the record count.
Every stored label links to `/prospects?category=…&stage=all`, which is why the Prospects filter
initialises from the URL and shows stored labels inside their group.

## Lawful activity

The catalogue only lists commercial activities an agency can legitimately serve. Some need a licence
before trading; `industry-compliance.ts` records the usual regulator and a one-sentence note shown in
Discover and added to proposal assumptions (for example the Pharmacy Council for a pharmacy, the
Minerals Commission for licensed small-scale mining, the Ministry of the Interior for private
security, or GES for a school). It does not give legal advice, and the assumption says so.

Unlawful activities are **not** categories, aliases or search phrases. `mentionsUnlawfulActivity()`
guards the data and the unit test fails if a label, search phrase or alias contains one (galamsey,
smuggling, counterfeit medicine, unlicensed forex, and so on). Licensed small-scale mining remains a
category because it is lawful; unlicensed galamsey is explicitly out of scope.

## Recommendations and evidence

Category and track content describes a **sector**, never a business. Reports label sector copy as
recommendations and put it in a section that says it is to be confirmed; recommendations carry no
evidence citations. A proposal plan reports what it rests on (`plan.evidence`):

- the website status, when a documented check established it;
- the needs the team actually recorded; and
- the report and confidence level used, when one exists.

When neither a website check nor a recorded need exists, the plan is marked `guidanceOnly`, the team
sees that in the reasons, and the proposal says it is a starting point to confirm in discovery.
Package choice follows recorded needs only: a fashion boutique that takes phone orders is not
upgraded to an ecommerce package on the strength of its category.


## Focus categories

`DEFAULT_SETTINGS.focusCategories` deliberately stays at the original 20. Widening it automatically
would change every prospect's industry-fit score without anyone asking. The Settings tab offers the
full catalogue, grouped and searchable, capped at the schema's 100 entries.

## Adding a category

1. Add one line in `industry-taxonomy.ts` using the `c(group, label, track, placesTypes, searchTerm, aliases)` helper.
2. Choose an existing track; add a new track only with its `TRACKS` guidance, `PROPOSAL_TEMPLATES`
   entry and `ARCHETYPES` entry (the unit test enforces all three).
3. Use only Table A types that already exist in `places-types.ts`.
4. Update the count in `tests/unit/taxonomy.test.ts` and the table above.
5. Run `npm run check` (typecheck, lint, unit + database tests, build) and the Playwright suites.

## Known follow-ups (not part of this change)

- A campaign can target at most 50 scope entries, so nationwide coverage of every category still
  needs several campaigns (or one campaign per group).
- Focus categories remain capped at 100; the picker covers all 388, but a workspace cannot focus on
  more than 100 at once without changing the settings schema.
