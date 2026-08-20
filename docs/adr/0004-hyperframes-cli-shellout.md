# ADR 0004: HyperFrames branding renders shell out to the `hyperframes` CLI

## Status
Accepted

## Context
Phase 0 investigated whether HyperFrames (v0.8.4) exposes a programmatic
producer API as an alternative to its CLI. `npm search hyperframes` does
surface `@hyperframes/sdk` ("Headless, framework-neutral HyperFrames
composition editing engine") and `@hyperframes/core`, suggesting a
programmatic path may exist. Phase 0 did not fully commit to CLI-only and
left this open for whichever phase actually needed rendering.

For Phase 5, actually building the branding renderer, the CLI path
(`npx hyperframes render`) is the one Phase 0 concretely proved end-to-end:
project init, GSAP vendoring (the CDN is blocked in this sandbox), and a
real render producing a valid, ffprobe-verified MP4. `@hyperframes/sdk`'s
actual API surface was not separately investigated for this phase — going
with the proven path was judged lower-risk than integrating an unverified
package under time constraints, consistent with Rule 6 (don't fabricate
SDK usage) applied the other direction: don't guess a headless API's shape
either.

## Decision
`renderBrandedReel()` (`src/lib/media/hyperframes-renderer.ts`) generates a
throwaway HyperFrames project directory per render (`package.json`,
`hyperframes.json`, `index.html` composition, vendored `gsap.min.js` copied
from the app's own `node_modules/gsap`, and the plain FFmpeg-assembled reel
copied in as an asset), then shells out to
`npx --yes hyperframes@0.8.4 render` via `execFile` (argument array, not a
shell string — same security posture as the FFmpeg wrapper) with `cwd` set
to that directory. The rendered output is located by reading
`<workDir>/renders/` and picking the newest `.mp4` — the CLI's own stdout
message format isn't parsed, since that's more likely to change across
versions than "an mp4 landed in the renders folder."

## Consequences
- Each branding render pays the cost of a fresh `npx hyperframes init`
  (network access to the npm registry, which — unlike most domains in this
  sandbox — is allow-listed) plus a full Chromium-based capture render.
  This is noticeably heavier than the FFmpeg-only reel-assembly step.
- If `@hyperframes/sdk` turns out to expose a genuine in-process render
  API, this can be swapped in later without changing
  `HyperFramesRenderInput`/`HyperFramesRenderResult` or any calling code —
  same boundary-isolation approach as ADR 0003 for Higgsfield.
- The throwaway project directory is deleted after each render; nothing
  about a specific project's branding data persists in it between renders.
