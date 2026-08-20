# Cinematic Property Reel Generator — Phase 1

Paste a property listing URL (or upload photos directly) to import a
property into the app. This is the foundation Phase 1 build: URL input,
platform detection, and image storage. Vision analysis, Higgsfield video
generation, and reel assembly are later phases.

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

None are required to boot Phase 1 — there is no database, queue, or external
API call yet. `.env.example` is intentionally not present in Phase 1; it
will be introduced when Phase 2 (Claude Vision) needs `ANTHROPIC_API_KEY`.

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
