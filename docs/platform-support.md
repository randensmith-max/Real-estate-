# Listing Platform Support (Phase 1)

Verified during Phase 1 development. Two independent checks were run for
each platform: (1) its published Terms of Service regarding automated data
collection, and (2) live network reachability from this development sandbox
via Playwright/Chromium.

| Platform | `supportLevel` | ToS restricts scraping? | Reachable from this sandbox? |
|---|---|---|---|
| Zillow (zillow.com) | `REQUIRES_AUTHORIZED_DATA_ACCESS` | Yes — Terms of Use prohibit data mining/robots/automated extraction; data licensed via Bridge Interactive for authorized partners | No — `net::ERR_TUNNEL_CONNECTION_FAILED` |
| Realtor.com | `REQUIRES_AUTHORIZED_DATA_ACCESS` | Yes — Terms of Use restrict automated extraction; data distributed via RDC partner feeds | No — `net::ERR_TUNNEL_CONNECTION_FAILED` |
| Redfin | `REQUIRES_AUTHORIZED_DATA_ACCESS` | Yes — Terms of Use explicitly prohibit scraping; Redfin has a history of enforcement | No — `net::ERR_TUNNEL_CONNECTION_FAILED` |
| Rightmove | `REQUIRES_AUTHORIZED_DATA_ACCESS` | Yes — terms restrict automated extraction (also verified in Phase 0) | No — `net::ERR_TUNNEL_CONNECTION_FAILED` (verified twice, Phase 0 and Phase 1) |

## Why no provider fabricates working extraction logic

The Phase 1 instructions were explicit: don't build extraction logic for a
site current technical or contractual access doesn't support. Both
conditions independently rule out live automated extraction for all four
platforms today:

1. **Legal**: all four sites' Terms of Service restrict/prohibit automated
   scraping outside an authorized data partnership.
2. **Technical**: none of the four domains are reachable from this
   development sandbox's network egress policy.

Either fact alone would justify not building unverified scraping code; both
together make it unambiguous. Each provider module (`src/lib/listing/providers/`)
implements `canHandle()` for real (so platform detection works and is
tested), and `importListing()` throws a typed
`ListingImportUnavailableError` carrying the specific reason above — never a
fabricated result.

## What would change this

- **Legal**: an authorized data licensing/partnership agreement with the
  platform (e.g. Zillow's Bridge Interactive, a Redfin/Realtor.com data
  partnership, a Rightmove data access agreement).
- **Technical**: confirming reachability from the actual production
  deployment network (this sandbox's restriction may not apply there) and
  building the structured-data-first extraction logic per Technical Plan
  §11's preference order (embedded JSON → semantic data → stable attributes
  → DOM fallback) once (1) is in place.

Until then, the manual upload fallback (`POST /api/upload`) is the working
import path.
