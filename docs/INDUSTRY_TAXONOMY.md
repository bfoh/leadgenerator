# Industry taxonomy (Milestone 3A)

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

All 20 original labels are preserved **verbatim** and still resolve to their original track, so every
saved prospect, report pack and proposal keeps working. `LEGACY_CATEGORY_LABELS` lists them and
`tests/unit/taxonomy.test.ts` asserts the mapping.

## Where things live

| File | Role |
| --- | --- |
| `src/lib/domain/places-types.ts` | The verified Places API (New) **Table A** allowlist, copied from Google's documentation. A type outside this list cannot compile. |
| `src/lib/domain/industry-taxonomy.ts` | `INDUSTRY_GROUPS` (30) and `INDUSTRY_CATEGORIES` (388) with `id`, `label`, `group`, `track`, `searchTerm`, `placesTypes`, `aliases`; lookups by label, id and group. |
| `src/lib/domain/categories.ts` | Historic public API: `DEFAULT_CATEGORIES`, `trackForCategory`, `searchTermForCategory`, `TRACKS`, plus `groupCategoryLabels` and `placesTypeForCategory`. |
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
   `galamsey`, `trotro`, `susu`, `kente`).

## Group-level targeting

A group label is a valid value anywhere a category is accepted:

- **Discover** — “All *X* industries” in the picker searches the group's phrase and files a tracked
  business under the group label; `trackForCategory` resolves it to the group's track.
- **Campaigns** — a group entry matches every prospect in that group, including categories added
  later. This matters because `campaigns.scope.categories` is capped at 50 entries (migration 009);
  30 group entries cover the whole catalogue. A *category* entry stays exact.

## Google Places mapping

`placesIncludedType()` sends `includedType` only when:

- the category has a verified mapping, **and**
- the researcher did not type custom terms.

The text query is always sent. This keeps searches precise for well-typed trades (`furniture_store`,
`snack_bar`, `pharmacy`) without hiding local businesses that Google typed differently, and never
blocks a search for an unmapped trade (`Mammy wagon transport`, `Galamsey`).

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

- Analytics still ranks the top raw category strings; with 388 labels it should roll up to industry
  groups before it is used for planning.
- A campaign can target at most 50 scope entries, so nationwide coverage of every category still
  needs several campaigns (or one campaign per group).
