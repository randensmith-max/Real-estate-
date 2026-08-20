import type { ImportedListing, ListingProvider } from "../types";
import { ListingImportUnavailableError } from "../types";

/**
 * Realtor.com (US, operated by Move, Inc.). Its Terms of Use restrict
 * automated scraping/data extraction, and listing data is distributed to
 * partners via official RDC data-feed agreements, not open scraping.
 * This sandbox's network policy also blocks realtor.com outright (verified
 * in Phase 1). Extraction logic is intentionally NOT implemented.
 */
export const realtorProvider: ListingProvider = {
  platform: "realtor",
  supportLevel: "REQUIRES_AUTHORIZED_DATA_ACCESS",
  supportReason:
    "Realtor.com's Terms of Use restrict automated data extraction; listing data access " +
    "requires an authorized RDC data-feed partnership. This environment's network policy " +
    "also blocks realtor.com outright (verified in Phase 1).",

  canHandle(url: string): boolean {
    try {
      return new URL(url).hostname.replace(/^www\./, "") === "realtor.com";
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
