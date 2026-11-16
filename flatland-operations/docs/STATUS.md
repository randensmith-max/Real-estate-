# Build status by phase

Development follows a phase gate. A phase is **verified** only after its workflows pass automated tests and a UI acceptance run with separate owner, manager and employee accounts.

| Phase | Code | Verification |
|---|---|---|
| 1 Core operations | Complete | **Verified** (see below). Waiting for the owner's own review. |
| 2 Equipment & inventory | Written ahead of schedule | Not yet verified. Basic tests only. |
| 3 Documents & inspections | Partly written (no e-signature) | Not yet verified |
| 4 Reporting & integrations | Reports written; QuickBooks not started | Not yet verified |

Code for Phases 2–4 was written early, in the first build pass. It is **not** considered complete until it goes through its own verification and report.

---

## Phase 1: Core Operations

### 1. What was built

- **Accounts and security:**
  - first-run owner setup, sign-in and sign-out
  - temporary passwords with a forced change at first sign-in
  - manager password resets and account deactivation
  - login lockout, CSRF protection, and secure session cookies
- **Roles**: owner, manager, employee and subcontractor, with permissions checked on the server for every request, plus record-level rules (for example, staff only see the jobs they're assigned to).
- **Dashboard:**
  - the company view for owners and managers, with quick actions
  - a personal view for employees, with the clock, their jobs, their time off and their documents
- **Customers**: create, edit, archive, search, job history, files. Duplicate names are blocked.
- **Jobs:**
  - numbering, types, the seven statuses plus Cancelled, site and directions, schedule, estimate, acres, owner-only quote
  - crew assignment with double-booking warnings
  - notes, photos and files, and an activity timeline
- **Time clock:** clock in and out, job choice, breaks, changing job mid-shift, and live today and this-week totals.
- **Manager time tools:**
  - corrections to times, breaks, job and notes
  - add missing shifts, close missed punches, void shifts
  - a reason is required for every change, and the full correction history is permanent
- **Weekly timesheets:**
  - employees submit their hours
  - approving a week locks it, and reopening requires a reason
  - overtime is split out
  - payroll CSV of approved hours only
- **People:**
  - profiles, emergency contacts, responsibilities
  - certifications with expiry dates
  - weekly availability, work history, personnel files
  - pay rates by effective date (owner only)
- **Time off**: request, approve or deny, cancel, and a team calendar.
- **Settings**: company name, time zone and overtime threshold, plus the audit log viewer and a roles reference.

### 2. Fully functional (verified)

These were verified with **33 automated server tests** (`npm test`) and a **31-step browser run** using three separate sessions: owner (desktop), manager (desktop) and employee (phone screen) (`npm run test:e2e:phase1`).

- **Permissions:**
  - Employee and subcontractor accounts are refused (403/404) on 17 manager-only endpoints.
  - Managers are refused on owner-only endpoints.
  - Signed-out requests are refused everywhere.
  - Quotes and pay rates are never sent to managers or employees.
  - A manager editing a job can't erase the owner's quote.
- **Persistence:** jobs, notes, profiles, availability and an active shift survive page refresh and sign-out/sign-in.
- **Changes appear everywhere they're used:**
  - a customer rename shows on job lists and the employee's view
  - a clock-in shows on the manager's dashboard, the job's crew list (on site) and the team list, and moves the job to In Progress
  - a manager correction updates the job's actual hours, the weekly total and the employee's own timesheet
  - an approved time-off request shows on the dashboard and calendar
- **Clear errors:**
  - missing or invalid fields are highlighted
  - duplicate customers are refused
  - impossible times (out before in, overlaps, future times, times that don't exist because of daylight saving) are refused with a readable message
  - weak passwords are refused
  - a failed sign-in doesn't reveal whether the account exists
- **Audit:** every change listed above writes to the audit history; the tests check 14 kinds of entries. Changes are recorded field by field, and the history can't be edited or deleted.

### 3. Not completed in Phase 1

- **Email/SMS** for invitations, password resets and notifications. This needs an email service; today the manager hands over temporary passwords.
- A drag-and-drop schedule/calendar board for jobs. Jobs are scheduled from the job form, and the dashboard shows today's jobs.
- Splitting one shift across two jobs. "Change job" moves the whole shift; a manager can split it by correcting it and adding a second shift.

### 4. Known limitations

- **Times:** times are entered and shown in the company time zone, which suits a one-region company. Changing the zone later doesn't change stored punches, but it does change which day a late-night punch falls on.
- **Approvals:**
  - a timesheet can't be approved until its week (Monday–Sunday) is over
  - managers can't correct or approve their own time; only the owner can
  - the owner can approve their own
- **Payroll:** overtime is calculated weekly over the configured threshold. Daily overtime and state-specific rules aren't modelled.
- **Login lockout:** this is stored in memory, so restarting the server clears it.
- **Clocking in:** clocking in needs a connection; there's no offline queue. Clock-in location (GPS) has fields in the database but isn't collected yet.
- **No email:** job and time-off notifications aren't sent, so people see them when they open the app.
- **Running the browser test:** the browser acceptance test needs Playwright installed and a server with an empty data folder.

### 5. Owner testing before Phase 2

Please try these yourself, with real people and real devices:

1. Install the app on the phones your crew actually uses (Add to Home Screen) and clock in and out in the field, with gloves, in sun and with weak signal.
2. Run one real week. Add a missed punch, correct a break, and then approve the week after Sunday.
3. Import the payroll CSV into your payroll process and confirm the columns and overtime split work for you.
4. Confirm the role rules match how you operate, for example that managers can't see pay rates or quotes and can't correct their own time.
5. Check the company time zone and the 40-hour overtime threshold in Settings.
6. Decide on hosting and HTTPS, and where off-site backups go (see OPERATIONS.md).
7. Tell me what's missing or awkward before Phase 2 verification starts.
