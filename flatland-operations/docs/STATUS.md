# Build status

## Functional now (backed by the database and enforced on the server)

**Phase 1: core operations (complete)**

- **Setup and accounts.** First-run owner setup, sign-in, sign-out, and a forced password change on temporary passwords. Managers can reset passwords, and accounts can be deactivated. Login throttling is in place.
- **Roles** for owner, manager, employee, and subcontractor, with server-side permissions and row-level access. Subcontractors can only clock in when authorized.
- **Dashboard** with live data:
  - who's clocked in, with missed-punch flags
  - today's jobs, and active jobs with estimated vs. actual hours
  - equipment in use, plus open maintenance and machines that are down
  - pending signatures
  - absences and unavailability for the next 7 days
  - low-stock alerts and approvals waiting
  - recent activity
  - quick actions
  - Employees see a personal version with a large clock button, their own jobs, and their own time off.
- **Customers.** Create, edit, archive, search, view job history, and attach files. Duplicate names are prevented.
- **Jobs:**
  - auto job numbers, all seven statuses plus Cancelled, and job types
  - site address, coordinates and directions, schedule, estimated hours, acres, and quote (owner-only)
  - crew and equipment assignment with overlap warnings
  - notes, photos and attachments, linked documents, and a full activity history
  - actual hours come from the time clock, and the first clock-in moves a job to In Progress
- **Time clock:**
  - big CLOCK IN / CLOCK OUT buttons, job selection, and breaks
  - changing jobs mid-shift
  - live today and this-week totals
  - duplicate clock-in and invalid clock-out are blocked at the database level
  - overnight shifts and DST are handled correctly
- **Manager time tools:**
  - view everyone's hours, and hours by job
  - correct clock-in and clock-out times, breaks, and the job
  - add missing shifts, resolve missed punches, and void entries
  - **every change requires a reason and is kept in an append-only history**
- **Weekly timesheets:**
  - employee submission
  - manager approval that locks the week, and reopening with a reason
  - overtime split, and payroll CSV of approved hours only
- **Employees:**
  - profile, employment status, emergency contact, and responsibilities
  - assigned equipment, training and certifications with expiry, and personnel documents
  - weekly availability and work history
  - versioned pay rates (owner only)
- **Time off.** Requests, approve or deny, cancel, and a team calendar with availability.

**Phase 2: equipment and inventory (core done)**

- Equipment and consumables:
  - categories, make, model, year, serial and asset numbers
  - a QR code generated for every item, and lookup by camera scan or a handheld scanner
  - photo, location, assignment, purchase information (owner-only costs), hour meter, condition, attachments
- An append-only movement log covering purchase, usage (on a job), transfer, return, count adjustment, damaged, and missing. Negative stock is blocked, unit cost is a weighted average, and low-stock thresholds are configurable per item.
- Shop and maintenance:
  - issues, repairs, preventative work, and shop projects
  - priority, assignee, labor hours, outside cost, parts drawn from inventory, and downtime tracking
  - recurring schedules by days or engine hours, with due and overdue reminders

**Phase 3: partial.** Inspections are complete; e-signatures are not.

- Inspections:
  - customizable checklist templates, plus seven optional starter checklists
  - Pass / Attention / Fail / N/A answers, with notes required on problems
  - photos, the hour-meter reading, and manager review
  - failed items automatically open a high-priority equipment issue
- Documents:
  - upload, folders, categories, and templates and forms
  - version history, links to jobs, people, customers and equipment, and visibility and sharing rules
  - search, inline PDF and image preview, and download

**Phase 4: partial.** Reports are complete; QuickBooks is not connected.

- Job cost summary, labor hours and cost, inventory usage, and maintenance cost and downtime, all with CSV export. Everything is clearly labelled as operational estimates, not accounting profit.

**Platform**

- Append-only audit log with a viewer.
- Company settings: name, time zone, and overtime threshold.
- Automatic daily backups and a "Back up now" button.
- Full JSON and per-table CSV export.
- Responsive layout: sidebar on desktop, bottom navigation on phones. Installable on a phone's home screen.

## Needs configuration before production

- **HTTPS hosting** and a persistent `DATA_DIR`. See OPERATIONS.md.
- **Off-site backup copies.** The app writes its backups locally only.
- **Pay rates** and **equipment operating costs**, so cost reports are meaningful.

## Not built yet

- **E-signature provider adapter and webhook.** This needs a provider account (see INTEGRATIONS.md). The "Request signatures" button is disabled, and the API returns 501.
- **QuickBooks Online sync.** This needs an Intuit developer app.
- **Email/SMS notifications**, such as invites, approvals, and maintenance alerts.
- Offline punch queue, a drag-and-drop schedule board, and a multi-location UI. The `locations` table already exists.
- Signature capture on inspections. The `requires_signature` flag and `signature_request_id` already exist and will use the e-signature provider.
