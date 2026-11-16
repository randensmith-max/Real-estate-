# External services and integrations

None of the integrations below are active. The app shows that state honestly in the UI and does not simulate any of them.

## Electronic signatures (Phase 3): requires a provider account

**Status:** the data model and UI placeholders are done. The provider adapter is not built. `POST /api/documents/:id/signature-requests` returns `501` with a clear message.

A typed name in this app is **not** a legal signature. Legally defensible e-signatures (ESIGN/UETA) need a provider that handles signer identity, consent, tamper sealing, and an audit certificate.

Recommended: **Dropbox Sign** (simple API, reasonably priced) or **DocuSign**.

To finish it:

1. Create an API account. Set `ESIGN_PROVIDER` and `ESIGN_API_KEY` in `.env`.
2. Build an adapter that:
   - uploads the selected `document_versions` file,
   - creates a request with the `signature_signers` (employees, subcontractors, customers),
   - stores `provider_request_id`.
3. Add a webhook endpoint (`/api/webhooks/esign`) that verifies the provider's signature header, records `signature_events`, updates signer status and `signed_at`, and on completion downloads the **final signed PDF** and **audit certificate** into `files` (`final_file_id`, `audit_file_id`).
4. The webhook needs a public HTTPS URL.

## QuickBooks Online (Phase 4): requires an Intuit developer app

**Status:** not connected. Reporting is operational only and labelled as estimates.

The design is ready: `external_refs(provider, entity_type, entity_id, external_id)` maps local records to QuickBooks ids, and `integration_connections` stores encrypted OAuth tokens.

Planned sync:

| Flatland | QuickBooks | Direction |
|---|---|---|
| Customers | Customers | two-way (QuickBooks wins on billing details) |
| Completed jobs | Invoices (draft) | Flatland → QuickBooks, then status `invoiced` |
| Consumable purchases | Bills / expenses | Flatland → QuickBooks |
| Approved timesheets | Time activities (or a payroll provider) | Flatland → QuickBooks |

Needs: an Intuit developer account, `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, an HTTPS redirect URI, and the owner to complete OAuth.

## Other dependencies to be aware of

- **Email/SMS** for invitations, password resets, and time-off notifications are not configured. Today, managers hand over temporary passwords and reset passwords in the app. Adding a transactional email service (Postmark, SES) is a small addition.
- **QR/barcode scanning** uses the browser's built-in `BarcodeDetector` (Chrome/Edge on Android and desktop, recent Safari). Where that's unavailable, the scanner falls back to typed input, which also works with Bluetooth or USB handheld scanners. QR labels are generated locally.
- **Maps** links open Google Maps with the job's coordinates or address. No API key is needed.
- **Offline use:** the app needs a connection. Clocking in with no signal fails with a clear message and nothing is recorded. An offline punch queue is a candidate for later work.
