# ADR 0001: No database in Phase 1

## Status
Accepted

## Context
The original 15-phase plan called for PostgreSQL + Prisma from the
foundation phase onward. The revised, simplified 5-phase plan explicitly
says: "Do NOT add PostgreSQL unless absolutely required" for Phase 1, whose
only job is URL input, platform detection, and image import/storage.

## Decision
Phase 1 persists each imported/uploaded project as a single JSON file under
`data/projects/{id}.json` via `ProjectStore` (`src/lib/storage/project-store.ts`).
No ORM, no schema migrations, no running database process.

## Consequences
- Zero infrastructure to run locally or in CI for Phase 1 — matches the
  "lean" instruction directly.
- `ProjectStore`'s public API (`create`, `save`, `get`, `list`) is narrow
  enough that swapping in a real database later (when a phase actually
  needs relational queries, concurrent writers, or multi-user isolation)
  is a contained change — nothing else in the app talks to storage
  directly.
- Known limitation: no concurrent-write safety (last write wins) and no
  transactional guarantees. Acceptable for a single-user local Phase 1;
  must be revisited before any multi-user or concurrent-job phase.
