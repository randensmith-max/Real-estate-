import type { ImportedListing, ListingProvider } from "../types";
import { ListingImportUnavailableError } from "../types";

/**
 * Rightmove (UK). Status verified during Phase 0: this development sandbox's
 * network egress policy blocks rightmove.co.uk outright (confirmed twice,
 * `net::ERR_TUNNEL_CONNECTION_FAILED` via Playwright). Rightmove's own terms
 * also restrict automated data extraction. Extraction logic is intentionally
 * NOT implemented here — per instruction, do not fabricate working scraping
 * logic for a site that cannot currently be verified to work.
 */
export const rightmoveProvider: ListingProvider = {
  platform: "rightmove",
  supportLevel: "REQUIRES_AUTHORIZED_DATA_ACCESS",
  supportReason:
    "Rightmove's terms restrict automated data extraction, and this environment's network " +
    "policy blocks rightmove.co.uk outright (verified in Phase 0 and re-verified in Phase 1). " +
    "Automated import requires an authorized Rightmove data access agreement.",

  canHandle(url: string): boolean {
    try {
      return new URL(url).hostname.replace(/^www\./, "") === "rightmove.co.uk";
    } catch {
      return false;
    }
  },

  async importListing(_url: string): Promise<ImportedListing> {
    throw new ListingImportUnavailableError(
      this.platform,
      this.supportLevel,
      this.supportReason
    );
  },
};
