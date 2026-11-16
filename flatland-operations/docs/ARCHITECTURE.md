# Architecture

## Stack

| Layer | Choice | Why |
|---|---|---|
| Server | Node.js + Express 5 + TypeScript (run with `tsx`) | Simple, well understood, one process |
| Database | SQLite (WAL mode) via `better-sqlite3` | No database server to run. Comfortably handles tens of users and hundreds of thousands of records. Gives a single-file backup. |
| Validation | `zod` on every request body | Consistent, field-level error messages |
| Time zones | `luxon` | Correct DST and overnight handling |
| Uploads | `multer` to local disk, content-hash recorded | Files are served only through authorized endpoints |
| Web app | React 19 + React Router + Vite, hand-written CSS design system | Responsive. Large touch targets for field use. Installable as a home-screen app via the web manifest. |

The SQL deliberately stays portable: plain tables, CHECK constraints, and partial unique indexes. Moving to PostgreSQL later (for multiple servers or many locations) means changing the driver layer, not the data model.

## Code layout

```
server/
  db/schema.sql          full schema for all four phases (migration 001)
  db/db.ts               connection, pragmas, migration runner
  lib/permissions.ts     roles → permissions (single source of truth)
  lib/auth.ts            password hashing, sessions, CSRF, login throttling
  lib/access.ts          row-level rules (assigned jobs, documents, attachments)
  lib/timeService.ts     clock in/out, breaks, corrections, locking, overlap checks
  lib/files.ts           upload validation, storage, file read authorization
  routes/*.ts            one router per area (jobs, time, users, inventory, …)
client/src/
  pages/*.tsx            one file per section
  components/            Layout, UI kit, attachments, scanner
tests/                   supertest integration tests against an in-memory database
```

## Security model

- **Authentication.** Email and password. Passwords are hashed with scrypt using a per-user salt. Sessions are random 256-bit tokens, and only their SHA-256 hash is stored. Cookies are `HttpOnly`, `SameSite=Strict`, and `Secure` in production. Failed sign-ins lock for 15 minutes after 5 attempts. Deactivating a person, changing their role, or resetting their password signs them out everywhere.
- **CSRF.** Every state-changing API call must carry the `X-Flatland-Request: 1` header, which cross-site forms can't send.
- **Authorization.** Every route checks permissions on the server (`requirePerm`) and applies row-level rules (`lib/access.ts`). For example, employees and subcontractors only ever receive jobs they are assigned to, and a job they aren't assigned to returns 404 to avoid revealing that it exists. Financial fields (pay rates, quotes, costs, margins) are removed from responses unless the user has `financials.view` (owners). The UI uses the same permission list only to decide what to show.
- **Uploads.** Allowed types are limited to PDF, images, and Office/CSV/TXT, up to 25 MB. The extension and MIME type must agree, and PDFs and images have their magic bytes checked. Files are stored under random names and served only after an access check. Anything that isn't a PDF or image is forced to download inside a CSP sandbox.
- **Headers.** Helmet supplies a strict Content-Security-Policy plus the usual hardening headers.
- **CSV exports.** Values are protected against spreadsheet formula injection.

## Audit and history

- `audit_log` is **append-only**: database triggers block UPDATE and DELETE. Every important change writes a human-readable summary plus a `{field: [old, new]}` diff. The same table drives "Recent activity" and the per-job activity timelines.
- `time_entry_revisions` is append-only. Every manager correction records the field, the original value, the new value, the reason (required), who made it, and when. Manual shifts and voids are recorded the same way. Time records are never silently overwritten or deleted.
- `inventory_movements` is append-only. Every quantity change records its type, amount, resulting quantity, user, and time.

## Time-tracking rules

- All instants are stored in UTC. The **company time zone** (Settings) defines days, Monday–Sunday payroll weeks, and how times are displayed. The device's own zone is also stored with each punch.
- A partial unique index (`user_id WHERE status='open'`) guarantees **at most one open shift per person**, even if someone double-taps on two phones. Clocking out with no open shift returns a clear error.
- Overnight shifts are computed from UTC differences, so 8 PM → 4 AM is 8 hours, including across DST changes. Manually entered times that don't exist because of a DST change are rejected rather than silently shifted.
- Corrections are validated: clock-out must be after clock-in, shifts are capped at 24 hours, shifts can't overlap, breaks must fall inside the shift and can't overlap, and nothing can be in the future.
- Shifts open longer than 14 hours are flagged as possible missed punches on the dashboard and timesheets.
- **Approval locks the week.** Approved weeks can't be edited and can't receive new punches. Reopening requires a reason and is audited. Payroll CSV export includes approved timesheets only, split into regular and overtime hours using the configurable weekly threshold. A manager can't approve their own timesheet (owners can).

## Data model overview (all phases)

People: `users`, `employee_profiles`, `pay_rates` (versioned by effective date), `certifications`, `availability`, `time_off_requests`, `sessions`
Work: `customers`, `jobs`, `job_assignments`, `job_equipment`, `job_notes`
Time: `time_entries`, `time_breaks`, `time_entry_revisions`, `timesheets`, `payroll_exports`, view `v_time_worked`
Assets (Phase 2): `inventory_items` (equipment and consumables), `inventory_movements`, `maintenance_records`, `maintenance_schedules`
Documents (Phase 3): `files`, `attachments` (polymorphic photos/files on any record), `document_folders`, `documents`, `document_versions`, `document_links`, `document_access`, `signature_requests`, `signature_signers`, `signature_events`
Inspections: `inspection_templates`, `inspection_template_items`, `inspections`, `inspection_responses` (label snapshots, so editing a template never rewrites history)
Integrations (Phase 4): `integration_connections`, `external_refs` (local ↔ QuickBooks id mapping)
Platform: `settings`, `locations` (multi-yard support), `audit_log`

Duplicates are prevented by unique constraints on user email, active customer name, job number, asset number, barcode, timesheet per person per week, and document version numbers.

## Scaling path

The app is sized for 5–10 users and handles well beyond that on one small server. When it outgrows that:

1. Move to PostgreSQL (the schema is portable) and run 2+ app instances behind a load balancer.
2. Move login throttling from in-memory to the database or Redis.
3. Move uploads to S3-compatible object storage (`lib/files.ts` is the only module that touches disk).
4. Use `locations` to scope jobs, people, and inventory per yard.
