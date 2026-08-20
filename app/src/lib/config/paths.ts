import path from "node:path";

const projectRoot = process.cwd();

/**
 * Uploaded/downloaded image root. Deliberately NOT under `public/` — Next.js's
 * production server (`next start`, Turbopack) snapshots `public/` contents at
 * server startup, so a file written to `public/` while the server is already
 * running 404s until the process restarts (confirmed in Phase 1 testing).
 * Runtime-written content must be served through a route handler instead —
 * see `src/app/api/images/[projectId]/[filename]/route.ts`.
 */
export const UPLOADS_ROOT = path.join(projectRoot, "data", "uploads");

/** Generated video clips — same reasoning as UPLOADS_ROOT, served via /api/videos/. */
export const VIDEOS_ROOT = path.join(projectRoot, "data", "videos");

/** Project metadata (JSON records) — also outside `public/`. */
export const PROJECTS_DATA_ROOT = path.join(projectRoot, "data", "projects");
