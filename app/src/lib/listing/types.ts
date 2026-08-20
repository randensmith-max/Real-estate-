/**
 * Normalized listing shape every provider (or the manual-upload fallback)
 * produces. Fields are optional, never fabricated — a provider that cannot
 * observe a fact simply omits it rather than guessing.
 */
export type ImportedListing = {
  sourceUrl: string;
  platform: string;
  address?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  price?: string | number;
  bedrooms?: number;
  bathrooms?: number;
  squareFeet?: number;
  propertyType?: string;
  description?: string;
  keyFeatures?: string[];
  imageUrls: string[];
  floorplanUrls?: string[];
  agentName?: string;
  brokerageName?: string;
};

export type ProviderSupportLevel =
  | "SUPPORTED"
  | "LIMITED"
  | "REQUIRES_AUTHORIZED_DATA_ACCESS"
  | "BLOCKED";

export interface ProviderSupportInfo {
  level: ProviderSupportLevel;
  reason: string;
}

/** Thrown by a provider's `importListing` when it cannot proceed — never a fabricated result. */
export class ListingImportUnavailableError extends Error {
  constructor(
    public readonly platform: string,
    public readonly level: ProviderSupportLevel,
    public readonly reason: string
  ) {
    super(`${platform}: ${reason}`);
    this.name = "ListingImportUnavailableError";
  }
}

export interface ListingProvider {
  readonly platform: string;
  readonly supportLevel: ProviderSupportLevel;
  readonly supportReason: string;

  canHandle(url: string): boolean;

  /** Throws `ListingImportUnavailableError` when `supportLevel !== "SUPPORTED"`. */
  importListing(url: string): Promise<ImportedListing>;
}
