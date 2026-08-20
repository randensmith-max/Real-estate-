import type { ImportedListing, ListingProvider } from "../types";
import { ListingImportUnavailableError } from "../types";

/**
 * Redfin (US). Redfin's Terms of Use explicitly prohibit scraping/automated
 * data collection, and Redfin has a history of enforcing this against
 * scrapers; data access for partners goes through official channels, not
 * open scraping. This sandbox's network policy also blocks redfin.com
 * outright (verified in Phase 1). Extraction logic is intentionally NOT
 * implemented.
 */
export const redfinProvider: ListingProvider = {
  platform: "redfin",
  supportLevel: "REQUIRES_AUTHORIZED_DATA_ACCESS",
  supportReason:
    "Redfin's Terms of Use explicitly prohibit automated scraping; listing data access " +
    "requires an authorized data partnership. This environment's network policy also " +
    "blocks redfin.com outright (verified in Phase 1).",

  canHandle(url: string): boolean {
    try {
      return new URL(url).hostname.replace(/^www\./, "") === "redfin.com";
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
