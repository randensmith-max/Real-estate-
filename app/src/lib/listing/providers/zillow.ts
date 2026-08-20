import type { ImportedListing, ListingProvider } from "../types";
import { ListingImportUnavailableError } from "../types";

/**
 * Zillow (US). Zillow's Terms of Use prohibit automated data mining,
 * robots, or similar extraction methods, and Zillow's listing/photo data
 * is licensed through official programs (e.g. Bridge Interactive) for
 * authorized MLS/partner access — not open scraping. Separately, this
 * sandbox's network policy blocks zillow.com outright (verified in Phase 1,
 * same failure pattern as the Phase 0 Rightmove finding). Extraction logic
 * is intentionally NOT implemented — see rightmove.ts for the same rationale.
 */
export const zillowProvider: ListingProvider = {
  platform: "zillow",
  supportLevel: "REQUIRES_AUTHORIZED_DATA_ACCESS",
  supportReason:
    "Zillow's Terms of Use prohibit automated scraping; listing data access requires an " +
    "authorized partner/MLS data licensing agreement (e.g. Bridge Interactive). This " +
    "environment's network policy also blocks zillow.com outright (verified in Phase 1).",

  canHandle(url: string): boolean {
    try {
      return new URL(url).hostname.replace(/^www\./, "") === "zillow.com";
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
