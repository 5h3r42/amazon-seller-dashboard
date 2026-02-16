export type SpApiRegion = "na" | "eu" | "fe";

export type IdentifierType = "EAN" | "UPC" | "GTIN";

export type ApiErrorCode =
  | "INVALID_EAN"
  | "CONFIG_ERROR"
  | "AMAZON_RATE_LIMITED"
  | "AMAZON_UPSTREAM_ERROR"
  | "INTERNAL_ERROR";

export interface LookupQuery {
  ean: string;
}

export interface LookupResultItem {
  asin: string;
  title: string | null;
  productType: string | null;
  brand?: string;
  images?: string[];
}

export interface LookupDebug {
  marketplaceId: string;
  region: SpApiRegion;
  identifiersType: IdentifierType;
  upstreamRequestId?: string;
  cacheHit?: boolean;
  rawResults?: number;
  rankedResults?: number;
  exactIdentifierMatches?: number;
}

export interface LookupResponse {
  input: LookupQuery;
  results: LookupResultItem[];
  debug?: LookupDebug;
}

export interface EnrichedPricingSummary {
  currency: string | null;
  listingPrice: number | null;
  shippingPrice: number | null;
  landedPrice: number | null;
  totalOfferCount: number;
  buyBoxWinner: boolean;
}

export interface EnrichedFeesSummary {
  status: "estimated" | "unavailable";
  currency?: string;
  totalFees?: number;
  message?: string;
}

export interface EnrichedStockSummary {
  status: "available" | "unavailable";
  source: "seller_sku" | "listings_search" | "none";
  sellerSku?: string;
  fbmQuantity?: number;
  fbaFulfillableQuantity?: number;
  fbaTotalQuantity?: number;
  message?: string;
}

export interface EnrichedCatalogData {
  asin: string;
  pricing?: EnrichedPricingSummary;
  fees?: EnrichedFeesSummary;
  stock?: EnrichedStockSummary;
  warnings: string[];
}

export interface EnrichedLookupResponse extends LookupResponse {
  enrichment?: EnrichedCatalogData;
}

export interface ErrorResponse {
  error: {
    code: ApiErrorCode;
    message: string;
  };
}
