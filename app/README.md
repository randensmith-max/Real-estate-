# Cinematic Property Reel Generator — Phases 1-5

Paste a property listing URL (or upload photos directly), analyze the
photos with Claude Vision, edit the resulting cinematic storyboard, generate
real Higgsfield video clips per approved scene, assemble every generated
clip into one downloadable 1080×1920 MP4 reel, then optionally overlay
premium branding (address, price, bed/bath, a feature callout, and a
closing card with your logo/agent info/CTA) via HyperFrames. All five
planned phases are implemented.

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

### Photo-pan fallback (no video-generation provider required)

Higgsfield (or any future video-generation provider) is a third-party
dependency outside this app's control — it can be down, rate-limited, or
mid-outage on the provider's own infrastructure (observed live: their image
upload step returning a `SignatureDoesNotMatch` from their own S3 bucket,
independent of credentials/billing/photos on this app's side). Rather than
leaving a project fully blocked when that happens:

- `POST /api/projects/[id]/scenes/[sceneId]/photo-pan`
  (`src/app/api/projects/[projectId]/scenes/[sceneId]/photo-pan/route.ts`) —
  renders a "Ken Burns" pan/zoom clip directly from the scene's source photo
  using ffmpeg's `zoompan` filter (`src/lib/media/ken-burns.ts`), entirely
  locally, no external provider or network call involved. Output already
  matches the canonical reel format (1080×1920/30fps/H.264), so it flows
  into `assembleReel` identically to a downloaded Higgsfield clip — same
  `status`/`generatedVideoUrl` fields, same reel-assembly eligibility.
- 8 camera-motion labels (`push_in`, `pull_back`, `pan_left`, `pan_right`,
  `dolly_forward`, `subtle_parallax`, `gentle_orbit`, `static`) each map to a
  distinct deterministic zoom/x/y expression triple; true 3D
  parallax/orbit isn't possible from a single flat photo, so these are
  tasteful 2D approximations, not a claim of equivalence to AI-generated
  camera movement. An unrecognized motion string falls back to a subtle
  static-ish zoom rather than throwing.
- UI: a "Use Photo Pan Instead" button per scene, plus a "Use Photo Pan for
  All" bulk action, both available wherever the existing Higgsfield
  generate/regenerate actions are (`StoryboardEditor.tsx`).
- **Live-tested**: found and fixed a real bug this way — `d` (the zoompan
  option controlling frame-hold count) is *not* readable inside the
  `zoom`/`x`/`y` expressions themselves (only `on`, the current output
  frame, is), so the frame-count denominator has to be inlined as a literal
  per render rather than referenced symbolically. Caught by actually running
  the filter against a real ffmpeg binary, not by the unit tests alone.
  Verified pixel-level: `push_in`/`pan_right` show real inter-frame motion
  (mean abs diff 11.2 / 26.6 on a 0-255 grayscale diff), `static` is
  correctly near-frozen (0.06). Also verified against a running server:
  upload → manual scene → `photo-pan` → servable clip → `reel` assembly, all
  succeeded end to end.
- 3 integration tests against the real ffmpeg binary
  (`src/lib/media/ken-burns.test.ts`): every camera motion renders to the
  correct format/duration, an unrecognized motion doesn't throw, and a
  missing source image correctly raises `FFmpegError`.

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

## Phase 5: HyperFrames branding

- `GET`/`PUT /api/brand-profile` — a single global `BrandProfile` (company
  name, agent name/phone/website, primary/secondary color, CTA text, logo)
  per the spec's exact field list. Deliberately not per-project or
  multi-tenant — spec: "don't overbuild white-label SaaS functionality."
- `POST /api/projects/[id]/branded-reel` — overlays the brand profile plus
  caller-supplied property facts (address/cityState/price/bedrooms/
  bathrooms/one optional feature callout) onto the already-assembled plain
  reel, via `src/lib/media/hyperframes-renderer.ts`. Per ADR 0004, this
  shells out to `npx hyperframes render` (the CLI path Phase 0 proved
  works) rather than an unverified programmatic SDK.
- `src/lib/media/hyperframes-composition.ts` is a pure function generating
  the HyperFrames HTML composition — no filesystem/process access, so its
  overlay-timing logic (opening title, price/bed-bath card, optional
  feature callout, closing brand card — each scaled to the reel's actual
  duration, never overlapping, the feature callout omitted entirely on a
  reel too short to fit it) is directly unit-tested (10 tests) independent
  of the CLI render step.
- **Fully live-tested end to end**, not just unit-tested: built a real
  12-second reel from synthetic clips, ran it through the actual
  HyperFrames CLI with a real brand profile and property data, downloaded
  the result, and re-verified with `ffprobe` outside the app — H.264,
  1080×1920, 30fps, AAC, 13s. Extracted frames at the opening, middle, and
  closing timestamps and visually confirmed each overlay actually renders
  correctly: address + city/state + price/bed/bath card at the open, the
  feature callout lower-third mid-reel, and the full brand card (company
  name, agent name, phone, website, CTA button) in the requested colors at
  the close.
- Style intentionally restrained per spec (premium/modern/cinematic, large
  clean typography, minimal copy, subtle scrim gradient, no particle
  effects/excessive gold/generic template look) — the property footage
  fills the frame throughout; overlays are lower-thirds/title cards, never
  full-screen graphics that hide the video.

## Post-implementation review

A full re-audit was done after all five phases were built (not just fresh
typecheck/lint/test/build — line-by-line review plus live exploitation
attempts against the running server). It found and fixed real issues rather
than confirming everything was already fine:

- **SSRF bypass**: `assertSafeImageUrl` checked literal IPv6 addresses for
  privacy but not IPv4-mapped IPv6 addresses (`::ffff:127.0.0.1`), which
  dual-stack sockets treat as the embedded IPv4 address on the wire.
  Confirmed exploitable, then fixed and locked in with 7 new regression
  tests (also covering decimal/octal-encoded IPv4 loopback, verified
  empirically against this environment's actual resolver behavior).
- **Unvalidated branding input**: `POST /api/projects/[id]/branded-reel`
  cast its request body to a TypeScript type without runtime validation —
  `bedrooms`/`bathrooms` were interpolated into generated HTML relying only
  on the compile-time type, not an actual runtime guarantee. Added zod
  validation; confirmed live that a crafted non-string `bedrooms` value is
  now cleanly rejected (400) rather than silently accepted.
- **CSS-injection via brand colors**: `primaryColor`/`secondaryColor` were
  interpolated unescaped directly into a `<style>` block with no format
  validation anywhere — a crafted value could break out of the CSS context
  into the composition's HTML/JS, which then actually executes in
  HyperFrames' real headless-browser render. Fixed with strict hex-color
  validation at both the API boundary and defensively inside the generator
  itself (in case a stored record predates the validation).
- **Short-reel timing overflow**: `computeTimings`' fixed minimum-duration
  clamps could schedule the closing brand card/CTA to start *after* a very
  short reel had already ended, so it would never actually appear. Verified
  empirically (a 1s reel scheduled the close at 1.8-3.8s), then fixed with
  proportional scaling that keeps every overlay window inside the reel's
  actual duration, with 2 new regression tests across a range of durations.
- **Stale cross-project UI state**: starting a new import/upload reset the
  storyboard/analysis but not the previously-built reel/branded-video
  state, which could reappear (showing the *previous* project's video)
  once the new project's storyboard reached "has generated scenes" again.
  Fixed by clearing all downstream state on both new-project actions and
  storyboard regeneration.
- Two lower-priority cleanups: a dead `logoPath` field in the brand-profile
  request schema that looked settable from client JSON but was actually
  always overwritten server-side (confusing, not exploitable — removed for
  clarity), and a path-containment check added to the brand-logo file
  resolution for defense-in-depth consistency with the other serving
  routes (not currently reachable with an attacker-controlled path, since
  `logoPath` is always server-generated, but inconsistent to skip it).

All fixes are live-tested against a running server, not just unit-tested —
see the corresponding test files' regression tests for exact reproduction
cases.

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
