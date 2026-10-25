<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Active engineering feature

The owner has requested the Google-first Business Resource Collector. Read
`docs/RESOURCE_COLLECTOR.md`; work on `feature/google-business-resource-collector`.
Extend the existing Asset Vault, guarded website reader and Google Places provider. Do not
rebuild Studio, implement Quick Concept, or resume other showcase redesigns. Google content
is transient preview material, never stored as independent resources or exported in ZIPs.
Only Place IDs may be retained. All verification uses mocked providers and local PGlite;
no unexpected paid call, production migration, push, deployment or outreach is authorized.
Adwoa’s creative approval remains pending independently of this engineering feature.

## Current creative work

Read `docs/ACTIVE_CREATIVE_HANDOFF.md` before continuing website design. For that design work, use
`feature/codex-creative-excellence`; preserve existing work. Adwoa’s House is the current
creative-review scope. The owner rejected the earlier sparse, dark, static layouts. The
new direction must be reviewed in a real browser, including phone layouts and actual motion.

**Stop for owner creative approval after presenting Adwoa’s House. Do not redesign
Nsroma Atelier or Bantama Design Office until that approval is explicit.** Passing tests
does not constitute creative approval.

Keep all improvements in the shared blueprint/builder/trusted renderer. Preserve exact
direction and Brand Kit binding, asset provenance and permissions, validation, immutable
history, organization isolation, concept disclosures and `publishReady: false`.

The owner authorized original synthetic concept imagery for Adwoa’s House using the
built-in image tool, without paid external API calls. Records live in `docs/assets/`;
all house images must remain clearly fictional, and publication is separately gated.

No pushing, deployment, production Supabase changes, paid provider calls or prospect
contact is authorized. Run local database tests through PGlite; browser verification must
use demo mode with Supabase and provider credentials blanked. Preserve the Next.js rules above.
