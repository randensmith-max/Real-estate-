-- Flatland Operations — database schema (migration 001)
--
-- Conventions
--   * All timestamps are stored as UTC ISO-8601 strings (e.g. 2026-11-16T14:05:00.000Z).
--   * Calendar dates (time off, week starts) are stored as YYYY-MM-DD in the company time zone.
--   * Money is stored as integer cents. Quantities are REAL.
--   * Nothing that matters is hard-deleted: records are archived/voided and every important
--     change is written to audit_log.
--   * The schema covers all four phases so later phases add features, not rebuilds.

PRAGMA foreign_keys = ON;

-- ───────────────────────── Company / platform ─────────────────────────

CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by  INTEGER REFERENCES users(id)
);

-- Supports multiple company locations/yards later. Single-location companies simply have one row.
CREATE TABLE locations (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  address     TEXT,
  timezone    TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ───────────────────────── People & access ─────────────────────────

CREATE TABLE users (
  id                    INTEGER PRIMARY KEY,
  email                 TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash         TEXT NOT NULL,
  role                  TEXT NOT NULL CHECK (role IN ('owner','manager','employee','subcontractor')),
  first_name            TEXT NOT NULL,
  last_name             TEXT NOT NULL,
  phone                 TEXT,
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  must_change_password  INTEGER NOT NULL DEFAULT 1,
  -- Subcontractors may only record time when explicitly authorised.
  can_record_time       INTEGER NOT NULL DEFAULT 1,
  location_id           INTEGER REFERENCES locations(id),
  last_login_at         TEXT,
  password_changed_at   TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_users_role ON users(role, status);

CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,           -- sha256 of the cookie token; raw token never stored
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  ip          TEXT,
  user_agent  TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- HR details for employees and subcontractors (1:1 with users).
CREATE TABLE employee_profiles (
  user_id                     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  job_title                   TEXT,
  employment_status           TEXT NOT NULL DEFAULT 'full_time'
                              CHECK (employment_status IN ('full_time','part_time','seasonal','contract','on_leave','terminated')),
  hire_date                   TEXT,
  termination_date            TEXT,
  company_name                TEXT,       -- subcontractor business name
  address                     TEXT,
  emergency_contact_name      TEXT,
  emergency_contact_phone     TEXT,
  emergency_contact_relation  TEXT,
  responsibilities            TEXT,
  notes                       TEXT,
  updated_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Pay rates are versioned so historical labor costs stay correct after a raise.
CREATE TABLE pay_rates (
  id              INTEGER PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hourly_cents    INTEGER NOT NULL CHECK (hourly_cents >= 0),
  effective_from  TEXT NOT NULL,          -- YYYY-MM-DD
  created_by      INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (user_id, effective_from)
);

CREATE TABLE certifications (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  issuer      TEXT,
  issued_on   TEXT,
  expires_on  TEXT,
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_cert_user ON certifications(user_id);

-- Recurring weekly availability. weekday: 0=Mon … 6=Sun.
CREATE TABLE availability (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday     INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  available   INTEGER NOT NULL DEFAULT 1,
  start_time  TEXT,                       -- HH:MM
  end_time    TEXT,
  note        TEXT,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, weekday)
);

CREATE TABLE time_off_requests (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('vacation','sick','personal','unpaid','other')),
  start_date    TEXT NOT NULL,
  end_date      TEXT NOT NULL,
  partial_day   INTEGER NOT NULL DEFAULT 0,
  reason        TEXT,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied','cancelled')),
  reviewed_by   INTEGER REFERENCES users(id),
  reviewed_at   TEXT,
  review_note   TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (end_date >= start_date)
);
CREATE INDEX idx_timeoff_dates ON time_off_requests(start_date, end_date, status);

-- ───────────────────────── Customers & jobs ─────────────────────────

CREATE TABLE customers (
  id               INTEGER PRIMARY KEY,
  name             TEXT NOT NULL,
  contact_name     TEXT,
  email            TEXT,
  phone            TEXT,
  billing_address  TEXT,
  notes            TEXT,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_by       INTEGER REFERENCES users(id),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- Prevents accidental duplicate customers with the same name.
CREATE UNIQUE INDEX uq_customers_name ON customers(name COLLATE NOCASE) WHERE status = 'active';

CREATE TABLE jobs (
  id                       INTEGER PRIMARY KEY,
  job_number               TEXT NOT NULL UNIQUE,
  name                     TEXT NOT NULL,
  customer_id              INTEGER REFERENCES customers(id),
  job_type                 TEXT NOT NULL CHECK (job_type IN ('chopping','farming','hauling','custom','other')),
  status                   TEXT NOT NULL DEFAULT 'new'
                           CHECK (status IN ('new','quoted','scheduled','in_progress','on_hold','completed','invoiced','cancelled')),
  description              TEXT,
  instructions             TEXT,
  site_address             TEXT,
  site_lat                 REAL,
  site_lng                 REAL,
  site_directions          TEXT,
  scheduled_start          TEXT,          -- UTC ISO
  scheduled_end            TEXT,
  estimated_hours          REAL,
  quoted_amount_cents      INTEGER,       -- operational estimate only; not an invoice
  acres                    REAL,
  location_id              INTEGER REFERENCES locations(id),
  completed_at             TEXT,
  created_by               INTEGER REFERENCES users(id),
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_jobs_status ON jobs(status, scheduled_start);
CREATE INDEX idx_jobs_customer ON jobs(customer_id);

CREATE TABLE job_assignments (
  job_id       INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  assigned_by  INTEGER REFERENCES users(id),
  assigned_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (job_id, user_id)
);
CREATE INDEX idx_job_assign_user ON job_assignments(user_id);

CREATE TABLE job_equipment (
  job_id       INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  item_id      INTEGER NOT NULL REFERENCES inventory_items(id),
  assigned_by  INTEGER REFERENCES users(id),
  assigned_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (job_id, item_id)
);
CREATE INDEX idx_job_equipment_item ON job_equipment(item_id);

CREATE TABLE job_notes (
  id          INTEGER PRIMARY KEY,
  job_id      INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_job_notes_job ON job_notes(job_id);

-- ───────────────────────── Time tracking ─────────────────────────

CREATE TABLE time_entries (
  id              INTEGER PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  job_id          INTEGER REFERENCES jobs(id),
  clock_in_at     TEXT NOT NULL,
  clock_out_at    TEXT,
  device_tz       TEXT,                   -- time zone reported by the employee's device
  source          TEXT NOT NULL DEFAULT 'clock' CHECK (source IN ('clock','manual')),
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','void')),
  notes           TEXT,
  clock_in_lat    REAL,
  clock_in_lng    REAL,
  created_by      INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (clock_out_at IS NULL OR clock_out_at > clock_in_at),
  CHECK ((status = 'open') = (clock_out_at IS NULL) OR status = 'void')
);
-- Database-level guarantee: a person can never have two open shifts.
CREATE UNIQUE INDEX uq_time_open_shift ON time_entries(user_id) WHERE status = 'open';
CREATE INDEX idx_time_user_in ON time_entries(user_id, clock_in_at);
CREATE INDEX idx_time_job ON time_entries(job_id);

CREATE TABLE time_breaks (
  id             INTEGER PRIMARY KEY,
  time_entry_id  INTEGER NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
  start_at       TEXT NOT NULL,
  end_at         TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (end_at IS NULL OR end_at > start_at)
);
CREATE UNIQUE INDEX uq_time_open_break ON time_breaks(time_entry_id) WHERE end_at IS NULL;

-- Append-only correction history. Time records are never silently overwritten.
CREATE TABLE time_entry_revisions (
  id             INTEGER PRIMARY KEY,
  time_entry_id  INTEGER NOT NULL REFERENCES time_entries(id),
  field          TEXT NOT NULL,           -- clock_in_at | clock_out_at | job_id | status | break | created
  old_value      TEXT,
  new_value      TEXT,
  reason         TEXT NOT NULL,
  changed_by     INTEGER NOT NULL REFERENCES users(id),
  changed_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_time_rev_entry ON time_entry_revisions(time_entry_id);

CREATE TRIGGER trg_time_rev_no_update BEFORE UPDATE ON time_entry_revisions
BEGIN SELECT RAISE(ABORT, 'time_entry_revisions is append-only'); END;
CREATE TRIGGER trg_time_rev_no_delete BEFORE DELETE ON time_entry_revisions
BEGIN SELECT RAISE(ABORT, 'time_entry_revisions is append-only'); END;

-- One weekly timesheet per person. week_start = Monday (company time zone).
CREATE TABLE timesheets (
  id                INTEGER PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users(id),
  week_start        TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','submitted','approved')),
  submitted_at      TEXT,
  approved_by       INTEGER REFERENCES users(id),
  approved_at       TEXT,
  approved_minutes  INTEGER,             -- snapshot of worked minutes at approval
  employee_note     TEXT,
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (user_id, week_start)
);

CREATE TABLE payroll_exports (
  id           INTEGER PRIMARY KEY,
  week_start   TEXT NOT NULL,
  row_count    INTEGER NOT NULL,
  exported_by  INTEGER NOT NULL REFERENCES users(id),
  exported_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Worked minutes per (non-void) entry = shift length − breaks. Open shifts are measured to "now".
CREATE VIEW v_time_worked AS
SELECT t.id, t.user_id, t.job_id, t.clock_in_at, t.clock_out_at, t.status, t.source,
  MAX(0, ROUND(
    (julianday(COALESCE(t.clock_out_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))) - julianday(t.clock_in_at)) * 1440
    - COALESCE((SELECT SUM((julianday(COALESCE(b.end_at, t.clock_out_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))) - julianday(b.start_at)) * 1440)
                FROM time_breaks b WHERE b.time_entry_id = t.id), 0)
  )) AS worked_minutes
FROM time_entries t
WHERE t.status <> 'void';

-- ───────────────────────── Phase 2: inventory & equipment ─────────────────────────

CREATE TABLE inventory_items (
  id                     INTEGER PRIMARY KEY,
  kind                   TEXT NOT NULL CHECK (kind IN ('equipment','consumable')),
  category               TEXT NOT NULL,   -- chopper, tractor, truck, trailer, implement, tool, other | fuel, fluids, parts, filters, supplies, components
  name                   TEXT NOT NULL,
  description            TEXT,
  photo_file_id          INTEGER REFERENCES files(id),
  asset_number           TEXT UNIQUE,
  serial_number          TEXT,
  barcode                TEXT UNIQUE,     -- value encoded in the QR code / barcode label
  make                   TEXT,
  model                  TEXT,
  year                   INTEGER,
  quantity               REAL NOT NULL DEFAULT 0,
  unit                   TEXT NOT NULL DEFAULT 'each',
  low_stock_threshold    REAL,            -- configurable per item; NULL = no alert
  storage_location       TEXT,
  location_id            INTEGER REFERENCES locations(id),
  assigned_user_id       INTEGER REFERENCES users(id),
  assigned_job_id        INTEGER REFERENCES jobs(id),
  purchase_price_cents   INTEGER,
  unit_cost_cents        INTEGER,         -- for consumables: average cost per unit
  hourly_cost_cents      INTEGER,         -- for equipment: operating cost rate used in job estimates
  supplier               TEXT,
  purchase_date          TEXT,
  meter_hours            REAL,            -- engine/separator hours where applicable
  condition              TEXT NOT NULL DEFAULT 'good' CHECK (condition IN ('new','good','fair','poor','out_of_service')),
  status                 TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  notes                  TEXT,
  created_by             INTEGER REFERENCES users(id),
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_items_kind ON inventory_items(kind, category, status);

-- Every quantity change, with who and when. Append-only.
CREATE TABLE inventory_movements (
  id               INTEGER PRIMARY KEY,
  item_id          INTEGER NOT NULL REFERENCES inventory_items(id),
  type             TEXT NOT NULL CHECK (type IN ('initial','purchase','usage','transfer','return','adjustment','damaged','missing')),
  quantity_change  REAL NOT NULL,
  quantity_after   REAL NOT NULL,
  unit_cost_cents  INTEGER,
  job_id           INTEGER REFERENCES jobs(id),
  maintenance_id   INTEGER REFERENCES maintenance_records(id),
  from_location    TEXT,
  to_location      TEXT,
  reason           TEXT,
  user_id          INTEGER NOT NULL REFERENCES users(id),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_moves_item ON inventory_movements(item_id, created_at);
CREATE INDEX idx_moves_job ON inventory_movements(job_id);
CREATE TRIGGER trg_moves_no_update BEFORE UPDATE ON inventory_movements
BEGIN SELECT RAISE(ABORT, 'inventory_movements is append-only'); END;
CREATE TRIGGER trg_moves_no_delete BEFORE DELETE ON inventory_movements
BEGIN SELECT RAISE(ABORT, 'inventory_movements is append-only'); END;

-- Equipment issues, repairs, preventative maintenance and shop projects.
CREATE TABLE maintenance_records (
  id               INTEGER PRIMARY KEY,
  item_id          INTEGER REFERENCES inventory_items(id),  -- NULL allowed for general shop projects
  kind             TEXT NOT NULL CHECK (kind IN ('issue','repair','preventative','shop_project')),
  title            TEXT NOT NULL,
  description      TEXT,
  priority         TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','critical')),
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','waiting_parts','completed','cancelled')),
  equipment_down   INTEGER NOT NULL DEFAULT 0,
  reported_by      INTEGER REFERENCES users(id),
  reported_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  assigned_to      INTEGER REFERENCES users(id),
  labor_hours      REAL NOT NULL DEFAULT 0,
  outside_cost_cents INTEGER NOT NULL DEFAULT 0,
  repair_notes     TEXT,
  downtime_start   TEXT,
  downtime_end     TEXT,
  completed_at     TEXT,
  inspection_id    INTEGER REFERENCES inspections(id),
  schedule_id      INTEGER REFERENCES maintenance_schedules(id),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_maint_status ON maintenance_records(status, priority);
CREATE INDEX idx_maint_item ON maintenance_records(item_id);

-- Recurring maintenance by calendar interval and/or meter hours.
CREATE TABLE maintenance_schedules (
  id               INTEGER PRIMARY KEY,
  item_id          INTEGER NOT NULL REFERENCES inventory_items(id),
  title            TEXT NOT NULL,
  interval_days    INTEGER,
  interval_hours   REAL,
  last_done_at     TEXT,
  last_done_hours  REAL,
  active           INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (interval_days IS NOT NULL OR interval_hours IS NOT NULL)
);

-- ───────────────────────── Files, documents & signatures ─────────────────────────

CREATE TABLE files (
  id             INTEGER PRIMARY KEY,
  storage_key    TEXT NOT NULL UNIQUE,    -- path relative to the uploads directory (never user-controlled)
  original_name  TEXT NOT NULL,
  mime_type      TEXT NOT NULL,
  size_bytes     INTEGER NOT NULL,
  sha256         TEXT NOT NULL,
  uploaded_by    INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Photos/attachments linked to any record (job, user, customer, item, maintenance, inspection).
CREATE TABLE attachments (
  id           INTEGER PRIMARY KEY,
  file_id      INTEGER NOT NULL REFERENCES files(id),
  entity_type  TEXT NOT NULL CHECK (entity_type IN ('job','user','customer','item','maintenance','inspection')),
  entity_id    INTEGER NOT NULL,
  caption      TEXT,
  created_by   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_attach_entity ON attachments(entity_type, entity_id);

CREATE TABLE document_folders (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  parent_id   INTEGER REFERENCES document_folders(id),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (parent_id, name)
);

CREATE TABLE documents (
  id            INTEGER PRIMARY KEY,
  title         TEXT NOT NULL,
  folder_id     INTEGER REFERENCES document_folders(id),
  category      TEXT,
  description   TEXT,
  is_template   INTEGER NOT NULL DEFAULT 0,
  -- 'managers' = owners/managers only; 'assigned' = managers + users in document_access; 'company' = all staff
  visibility    TEXT NOT NULL DEFAULT 'managers' CHECK (visibility IN ('managers','assigned','company')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_by    INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE document_versions (
  id           INTEGER PRIMARY KEY,
  document_id  INTEGER NOT NULL REFERENCES documents(id),
  version_no   INTEGER NOT NULL,
  file_id      INTEGER NOT NULL REFERENCES files(id),
  note         TEXT,
  uploaded_by  INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (document_id, version_no)
);

CREATE TABLE document_links (
  document_id  INTEGER NOT NULL REFERENCES documents(id),
  entity_type  TEXT NOT NULL CHECK (entity_type IN ('job','user','customer','item')),
  entity_id    INTEGER NOT NULL,
  PRIMARY KEY (document_id, entity_type, entity_id)
);
CREATE INDEX idx_doclinks_entity ON document_links(entity_type, entity_id);

CREATE TABLE document_access (
  document_id  INTEGER NOT NULL REFERENCES documents(id),
  user_id      INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (document_id, user_id)
);

-- Signature workflows are executed by an external e-signature provider (Phase 3).
-- These tables mirror the provider's state; the provider's audit certificate is the legal record.
CREATE TABLE signature_requests (
  id                   INTEGER PRIMARY KEY,
  document_id          INTEGER NOT NULL REFERENCES documents(id),
  version_id           INTEGER NOT NULL REFERENCES document_versions(id),
  provider             TEXT NOT NULL,
  provider_request_id  TEXT UNIQUE,
  subject              TEXT,
  status               TEXT NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','sent','partially_signed','completed','declined','voided','expired','error')),
  final_file_id        INTEGER REFERENCES files(id),
  audit_file_id        INTEGER REFERENCES files(id),
  created_by           INTEGER REFERENCES users(id),
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at         TEXT
);

CREATE TABLE signature_signers (
  id                  INTEGER PRIMARY KEY,
  request_id          INTEGER NOT NULL REFERENCES signature_requests(id),
  user_id             INTEGER REFERENCES users(id),
  name                TEXT NOT NULL,
  email               TEXT NOT NULL,
  signer_role         TEXT NOT NULL CHECK (signer_role IN ('employee','subcontractor','customer','manager','other')),
  sign_order          INTEGER NOT NULL DEFAULT 1,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','viewed','signed','declined')),
  signed_at           TEXT,
  provider_signer_id  TEXT
);

CREATE TABLE signature_events (
  id           INTEGER PRIMARY KEY,
  request_id   INTEGER REFERENCES signature_requests(id),
  event_type   TEXT NOT NULL,
  payload      TEXT,
  received_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ───────────────────────── Inspections & checklists ─────────────────────────

CREATE TABLE inspection_templates (
  id                  INTEGER PRIMARY KEY,
  name                TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description         TEXT,
  applies_to          TEXT,               -- e.g. equipment category; NULL = any
  requires_signature  INTEGER NOT NULL DEFAULT 0,
  active              INTEGER NOT NULL DEFAULT 1,
  created_by          INTEGER REFERENCES users(id),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE inspection_template_items (
  id                 INTEGER PRIMARY KEY,
  template_id        INTEGER NOT NULL REFERENCES inspection_templates(id) ON DELETE CASCADE,
  position           INTEGER NOT NULL,
  label              TEXT NOT NULL,
  help_text          TEXT,
  create_issue_on_fail INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE inspections (
  id                    INTEGER PRIMARY KEY,
  template_id           INTEGER NOT NULL REFERENCES inspection_templates(id),
  template_name         TEXT NOT NULL,     -- snapshot so edits to templates don't rewrite history
  item_id               INTEGER REFERENCES inventory_items(id),
  job_id                INTEGER REFERENCES jobs(id),
  performed_by          INTEGER NOT NULL REFERENCES users(id),
  performed_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  overall_result        TEXT NOT NULL CHECK (overall_result IN ('pass','attention','fail')),
  meter_hours           REAL,
  notes                 TEXT,
  status                TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','reviewed')),
  reviewed_by           INTEGER REFERENCES users(id),
  reviewed_at           TEXT,
  review_notes          TEXT,
  signature_request_id  INTEGER REFERENCES signature_requests(id)
);
CREATE INDEX idx_insp_item ON inspections(item_id, performed_at);

CREATE TABLE inspection_responses (
  id                INTEGER PRIMARY KEY,
  inspection_id     INTEGER NOT NULL REFERENCES inspections(id),
  template_item_id  INTEGER REFERENCES inspection_template_items(id),
  label             TEXT NOT NULL,        -- snapshot
  result            TEXT NOT NULL CHECK (result IN ('pass','attention','fail','na')),
  note              TEXT
);

-- ───────────────────────── Phase 4: integrations ─────────────────────────

CREATE TABLE integration_connections (
  provider         TEXT PRIMARY KEY,       -- 'quickbooks', 'esign'
  status           TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('disconnected','connected','error')),
  external_account TEXT,                   -- e.g. QuickBooks realm id
  token_ciphertext TEXT,                   -- encrypted at rest; never returned by the API
  connected_by     INTEGER REFERENCES users(id),
  connected_at     TEXT,
  last_sync_at     TEXT,
  last_error       TEXT
);

-- Maps local records to external ids (QuickBooks customers, invoices, items, employees …).
CREATE TABLE external_refs (
  provider     TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    INTEGER NOT NULL,
  external_id  TEXT NOT NULL,
  synced_at    TEXT,
  PRIMARY KEY (provider, entity_type, entity_id),
  UNIQUE (provider, entity_type, external_id)
);

-- ───────────────────────── Audit ─────────────────────────

-- Append-only record of important changes. Also powers the "recent activity" feed.
CREATE TABLE audit_log (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER REFERENCES users(id),
  action       TEXT NOT NULL,              -- e.g. job.create, time.edit, user.role_change
  entity_type  TEXT,
  entity_id    INTEGER,
  summary      TEXT NOT NULL,              -- human-readable sentence
  changes      TEXT,                       -- JSON {field: [old, new]}
  ip           TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_audit_created ON audit_log(created_at);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
