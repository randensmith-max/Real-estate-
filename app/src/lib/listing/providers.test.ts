import { describe, it, expect } from "vitest";
import { zillowProvider } from "./providers/zillow";
import { realtorProvider } from "./providers/realtor";
import { redfinProvider } from "./providers/redfin";
import { rightmoveProvider } from "./providers/rightmove";
import { ListingImportUnavailableError } from "./types";

const providers = [zillowProvider, realtorProvider, redfinProvider, rightmoveProvider];

describe("listing providers report their real limitations rather than fabricating extraction", () => {
  for (const provider of providers) {
    it(`${provider.platform}: reports a non-SUPPORTED level with a specific reason`, () => {
      expect(provider.supportLevel).not.toBe("SUPPORTED");
      expect(provider.supportReason.length).toBeGreaterThan(20);
    });

    it(`${provider.platform}: importListing throws ListingImportUnavailableError instead of returning fake data`, async () => {
      await expect(provider.importListing("https://example.com/whatever")).rejects.toBeInstanceOf(
        ListingImportUnavailableError
      );
    });

    it(`${provider.platform}: thrown error carries the platform and reason for the UI to display`, async () => {
      try {
        await provider.importListing("https://example.com/whatever");
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ListingImportUnavailableError);
        const typed = error as ListingImportUnavailableError;
        expect(typed.platform).toBe(provider.platform);
        expect(typed.reason).toBe(provider.supportReason);
      }
    });
  }
});
