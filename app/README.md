# Cinematic Property Reel Generator — Phase 1 + Phase 2

Paste a property listing URL (or upload photos directly), analyze the
photos with Claude Vision, and edit the resulting cinematic storyboard
before any Higgsfield credits are spent. Higgsfield video generation and
final reel assembly are later phases.

## Supported listing platforms

None of the four target platforms can be **automatically** imported yet —
see [`docs/platform-support.md`](../docs/platform-support.md) for the exact,
verified reason for each (Terms of Service restrictions and/or this
environment's network policy blocking the domain outright). Every platform's
`ListingProvider` correctly detects its own URLs and reports
`REQUIRES_AUTHORIZED_DATA_ACCESS` with a specific explanation rather than
attempting scraping that isn't authorized or currently reachable.

**The manual upload fallback is the working import path today.** Paste any
unsupported/blocked URL and the UI reveals an upload form: add photos plus
optional address/price/bedrooms/bathrooms/property type/description. That
data flows through the same `ImportedListing` shape and property preview as
an automated import would.

## Local development

Requirements: Node.js 22+.

```bash
cd app
npm install
npm run build      # also generates Next.js route types needed by typecheck
npm run dev         # http://localhost:3000
```

Other scripts:

```bash
npm run typecheck   # strict TypeScript, no emit
npm run lint         # eslint (Next.js config + @typescript-eslint)
npm run test          # vitest — unit tests for src/lib/**
npm run build          # next build (also runs TypeScript)
```

## Environment variables

See `.env.example`. None are required to boot the app or use URL import /
photo upload — only `ANTHROPIC_API_KEY` is required, and only at the moment
`POST /api/projects/[id]/analyze` is called (a missing key returns a clean
503, not a boot failure). `HF_CREDENTIALS`/`HF_API_KEY`+`HF_API_SECRET` are
listed for Phase 3 but unused until then.

## Phase 2: photo analysis and storyboard

- `POST /api/projects/[id]/analyze` — runs `ClaudeVisionProvider` (official
  `@anthropic-ai/sdk`, tool-use forced structured output, zod-validated,
  one repair-retry on schema failure) over every image in the project.
  Requires `ANTHROPIC_API_KEY`. **Not live-tested in this environment** — no
  API key is available here — but the schema validation, repair-retry logic,
  and error handling are unit-tested against a mocked SDK client
  (`src/lib/vision/claude-vision-provider.test.ts`), and the endpoint's
  clean-failure behavior (503 when unconfigured) was verified live.
- `POST /api/projects/[id]/storyboard` — builds an ordered ~6-10 scene
  storyboard from the analyzed photos (`src/lib/storyboard/shot-selector.ts`):
  ranks by composite quality/marketing/cinematic score, caps repetitive room
  types (spec example: eight bedroom photos must not become a five-bedroom-
  shot reel — verified by test), then orders into a natural walkthrough
  sequence without forcing room types the property doesn't have.
- `PATCH /api/projects/[id]/storyboard` — replaces the storyboard with a
  user-edited version (reorder, remove, replace camera motion, edit prompt,
  change duration, approve) after zod validation. No Higgsfield credit is
  spent by anything in Phase 2.
- Higgsfield prompts (`src/lib/storyboard/prompt-generator.ts`) always start
  from a fixed property-preservation instruction, with the scene's camera
  motion appended — never freeform per-scene text.

## Architecture notes

- **No database.** Project records are single JSON files under
  `data/projects/` (git-ignored). This is a deliberate Phase 1 simplification
  — see `docs/adr/0001-no-database-in-phase-1.md`.
- **Uploaded/downloaded images are NOT stored in `public/`.** They live in
  `data/uploads/` (private) and are served through
  `src/app/api/images/[projectId]/[filename]/route.ts`. This was a real bug
  found during Phase 1 testing: Next.js 16's production server snapshots
  `public/` at startup, so files written there while the server is already
  running 404 until restart. See `docs/adr/0002-image-serving-not-public.md`.
- **`ListingProvider` interface** (`src/lib/listing/types.ts`) is the
  extension point for future platforms. Each provider reports a
  `supportLevel` (`SUPPORTED` / `LIMITED` / `REQUIRES_AUTHORIZED_DATA_ACCESS`
  / `BLOCKED`) and throws `ListingImportUnavailableError` with a specific
  reason rather than attempting unauthorized or unverified scraping.
- **SSRF protection** (`src/lib/media/ssrf.ts`) validates every remote image
  URL before fetching: scheme allow-list, hostname/IP resolution, and
  rejection of loopback/private/link-local/cloud-metadata ranges.
