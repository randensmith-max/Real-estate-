import type { ListingProvider } from "./types";
import { zillowProvider } from "./providers/zillow";
import { realtorProvider } from "./providers/realtor";
import { redfinProvider } from "./providers/redfin";
import { rightmoveProvider } from "./providers/rightmove";

export const LISTING_PROVIDERS: readonly ListingProvider[] = [
  zillowProvider,
  realtorProvider,
  redfinProvider,
  rightmoveProvider,
];

/**
 * Platform detection (Phase 1 requirement). Returns the matching provider,
 * or `null` for an unrecognized domain — an unknown domain must produce
 * "Unsupported listing platform", never a silent generic scrape attempt.
 */
export function detectProvider(url: string): ListingProvider | null {
  return LISTING_PROVIDERS.find((provider) => provider.canHandle(url)) ?? null;
}
