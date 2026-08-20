# ADR 0003: Higgsfield generation uses the SDK's blocking `subscribe()`, not manual polling

## Status
Accepted

## Context
The Phase 3 spec's `VideoGenerationProvider` interface (`generateScene` /
`getJobStatus` / `downloadResult`) implies a classic submit-then-poll-then-
download async job pattern. Inspecting the actual installed `@higgsfield/client`
v0.2.1 type declarations (not just its README) showed the v2 client's public
interface is narrower than that:

```ts
export interface HiggsfieldClient {
  subscribe<TEndpoint extends string>(endpoint: TEndpoint, options: SubscribeOptions<any>): Promise<V2Response>;
  configure(config: V2ClientConfig): void;
}
```

There is no separate "check status of an existing request_id" method
exposed on the v2 client. `subscribe()`'s own `withPolling` option (default
`true`) handles submit-and-poll-until-terminal internally, returning the
resolved `V2Response` directly — not a `JobSet` with `.isCompleted`/`.jobs[]`
as the package's README examples show. (This is a real discrepancy between
the README and the shipped `.d.ts` — the type declarations are authoritative
for what actually compiles and is officially supported, so they were
followed over the prose docs.)

## Decision
`HiggsfieldProvider.generateScene()` calls `subscribe(..., { withPolling:
true })` — the SDK's own default/recommended mode — and caches the fully
resolved `V2Response` (status, video URL) in memory, keyed by `request_id`.
`getJobStatus()` and `downloadResult()` read from that cache rather than
performing an independent live poll against the provider.

## Consequences
- By the time `generateScene()` returns, the scene's generation has already
  fully completed, failed, or been flagged NSFW — there is no meaningful
  intermediate "queued"/"in_progress" state observable from outside a single
  `generateScene()` call with this SDK version.
- The route handler (`POST /api/projects/[id]/scenes/[sceneId]/generate`)
  therefore generates one scene per request and blocks for the duration of
  that scene's generation. The spec's "Generating scene 1 of 8" progress
  UI is implemented at the *client* level — the UI issues one request per
  approved scene, sequentially, and updates its own progress indicator
  between requests — rather than via granular server-side job polling.
  This also directly satisfies the "concurrency should be conservative...
  do not fire every scene simultaneously" requirement, since scenes are
  generated one HTTP request at a time by construction.
- If a future SDK version exposes a genuine "get status by request_id"
  method, `getJobStatus`/`downloadResult` can be reimplemented against it
  without changing the `VideoGenerationProvider` interface or any calling
  code — the interface boundary was designed for exactly this kind of
  provider-internal change.
- Image upload uses the v1 client's `uploadImage()` (the v2 client has no
  upload method of its own, and `/v1/image2video/dop` requires a hosted
  `image_url`, not raw bytes) — the v1 client is labelled "deprecated" in
  the README but remains fully functional and is the only officially
  provided way to get local bytes onto Higgsfield's CDN.
