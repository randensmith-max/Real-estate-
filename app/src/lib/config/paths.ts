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

/** Final assembled reels + thumbnails — served via /api/renders/. */
export const RENDERS_ROOT = path.join(projectRoot, "data", "renders");

/** Scratch working directory for intermediate ffmpeg files (normalized clips, concat lists) — never served. */
export const RENDER_WORK_ROOT = path.join(projectRoot, "data", "render-work");

/** Project metadata (JSON records) — also outside `public/`. */
export const PROJECTS_DATA_ROOT = path.join(projectRoot, "data", "projects");

/** Single global brand profile record. */
export const BRAND_DATA_ROOT = path.join(projectRoot, "data", "brand");

/** Pseudo-project id under UPLOADS_ROOT for the brand logo, reusing the existing image-store pipeline. */
export const BRAND_LOGO_PROJECT_ID = "brand";
