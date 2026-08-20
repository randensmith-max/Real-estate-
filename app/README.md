# Cinematic Property Reel Generator — Phases 1-4

Paste a property listing URL (or upload photos directly), analyze the
photos with Claude Vision, edit the resulting cinematic storyboard, generate
real Higgsfield video clips per approved scene, then assemble every
generated clip into one downloadable 1080×1920 MP4 reel. Branding
(HyperFrames) is the last remaining phase.

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
photo upload. `ANTHROPIC_API_KEY` is required only when
`POST /api/projects/[id]/analyze` is called; `HF_CREDENTIALS` (or
`HF_API_KEY`+`HF_API_SECRET`) is required only when
`POST /api/projects/[id]/scenes/[sceneId]/generate` is called. Both return a
clean 503 if unset, never a boot failure.

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

## Phase 3: Higgsfield cinematic video generation

- `POST /api/projects/[id]/scenes/[sceneId]/generate` — generates (or
  regenerates) exactly one scene: uploads the source image via the official
  v1 `@higgsfield/client` `uploadImage()`, then calls the v2 client's
  `subscribe('/v1/image2video/dop', { withPolling: true })`. Requires
  `HF_CREDENTIALS`. **Not live-tested with real credentials** — none are
  available in this environment — but (a) provider logic (upload → subscribe
  → status mapping → error wrapping) is unit-tested against a mocked SDK
  client, (b) the clean 503-when-unconfigured and 404-when-unknown-scene
  paths were verified live, and (c) a placeholder-credential probe against
  the *real* Higgsfield endpoint (same technique as the Phase 0 report)
  confirmed the integration reaches the real API and correctly parses a
  real structured error response (`NotEnoughCreditsError`) rather than a
  network failure — and produced the identical result Phase 0 found,
  corroborating that this isn't a fluke.
- The client generates one scene per HTTP request, sequentially, showing
  "Generating scene X of Y" — this isn't a simplification but a direct
  consequence of the real SDK's public interface, which has no separate
  "check status of an existing job" method; see
  `docs/adr/0003-higgsfield-polling-model.md` for the full explanation
  (including a real discrepancy found between the SDK's README examples and
  its actual shipped `.d.ts` types — the types were followed).
- Per-scene review: each generated clip gets a preview player plus
  Approve/Reject/Regenerate controls. Rejecting or regenerating never
  touches any other scene.
- Property-preservation bias: generation failures (including NSFW
  moderation rejections) mark only that scene `"rejected"` with a visible
  reason — nothing is silently retried or hidden.

## Phase 4: FFmpeg reel assembly

- `POST /api/projects/[id]/reel` (multipart, optional `music` field) —
  assembles every storyboard scene with a generated clip, in storyboard
  order, into one final MP4. **Fully live-tested** — no external
  credentials needed, just ffmpeg (confirmed present since Phase 0).
- Pipeline (`src/lib/media/reel-assembler.ts`), all via `execFile` argument
  arrays only, never shell string concatenation (spec's explicit FFmpeg
  security requirement):
  1. **Normalize** each clip to 1080×1920/30fps/H.264/yuv420p using
     scale+pad (never a naive stretch — room proportions are preserved),
     with a restrained fade-to-black at scene boundaries (no fade-in on the
     first scene, no fade-out on the last).
  2. **Concatenate** the normalized clips in storyboard order via the
     concat demuxer.
  3. **Mix in music** if supplied: trimmed to the reel's duration, faded
     in/out, loudness-normalized (`loudnorm`). No music is shipped by
     default — spec: never auto-ship copyrighted commercial tracks.
  4. **Extract a thumbnail** and **validate the final file with ffprobe**
     (codec, resolution) before returning success — an unvalidated file is
     never handed back.
- 7 integration tests run the real ffmpeg/ffprobe binaries against
  generated lavfi test clips (`src/lib/media/reel-assembler.test.ts`) — no
  mocking, since this module is almost entirely a thin wrapper around
  ffmpeg subprocess calls. Also verified live end-to-end against a running
  server: real synthetic clips (standing in for Higgsfield output, which
  can't be produced without live credentials) were assembled into a real
  reel, downloaded, and re-verified with `ffprobe` outside the app —
  1080×1920, H.264, 30fps, AAC, exactly the target format.
- `withinTargetDuration` (20-40s) is reported but not enforced — a short
  storyboard still produces a valid, downloadable reel rather than an error.

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
