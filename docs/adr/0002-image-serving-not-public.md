# ADR 0002: Serve uploaded/imported images through a route handler, not `public/`

## Status
Accepted

## Context
The first Phase 1 implementation saved uploaded/downloaded images to
`public/uploads/{projectId}/{hash}.{ext}`, relying on Next.js's standard
static-file serving of `public/`. Live smoke testing (not just unit tests)
during Phase 1 found this broken in production mode: a file written to
`public/` while `next start` (Turbopack) is already running returns 404
until the server process restarts. Pre-existing `public/` assets (present
at build time) served fine; only runtime-written files were affected.
Confirmed reproducible: restart the process without a rebuild and the same
file starts serving successfully — so the issue is a startup-time snapshot
of `public/`, not a build-time one.

## Decision
Uploaded/downloaded images are stored outside `public/`, under
`data/uploads/{projectId}/{hash}.{ext}` (private, git-ignored, alongside
`data/projects/`). They are served through
`src/app/api/images/[projectId]/[filename]/route.ts`, which:
- validates both path segments against a strict allow-listed character set,
- resolves the final path and verifies it stays inside the uploads root
  (path-traversal defense — both segments come directly from the URL),
- returns the correct `Content-Type` from the file extension,
- sets a long, safe cache lifetime since filenames are content-addressed by
  SHA-256 (identical bytes always produce identical filenames, so a cached
  response is never stale).

## Consequences
- Correct behavior confirmed live: uploading while the server is already
  running immediately serves the new image (tested end-to-end, not just
  unit-tested).
- One extra route handler versus "free" static serving, but this is the
  correct general pattern for any runtime-mutable content in Next.js
  regardless of this specific Turbopack snapshot behavior — `public/` is
  documented for static build-time assets only.
- This generalizes directly to later phases: generated video clips,
  rendered reels, and brochure exports should follow the same pattern
  (a serving route over private storage), not be placed in `public/`.
