import { SellingPartnerApiAuth } from "@sp-api-sdk/auth";
import { sellingPartnerRegions } from "@sp-api-sdk/common";
import {
  FbaInventoryApiClient,
  GetInventorySummariesGranularityTypeEnum,
  type InventorySummary,
} from "@sp-api-sdk/fba-inventory-api-v1";
import {
  ListingsItemsApiClient,
  SearchListingsItemsIdentifiersTypeEnum,
  SearchListingsItemsIncludedDataEnum,
  type Item as ListingsItem,
} from "@sp-api-sdk/listings-items-api-2021-08-01";
import {
  GetItemOffersItemConditionEnum,
  GetPricingItemConditionEnum,
  GetPricingItemTypeEnum,
  ProductPricingApiClient,
  type OfferListingCountType,
  type OfferType,
} from "@sp-api-sdk/product-pricing-api-v0";

import type {
  EnrichedCatalogData,
  EnrichedFeesSummary,
  EnrichedPricingSummary,
  EnrichedStockSummary,
  IdentifierType,
} from "@/lib/catalog/types";
import { getEnv } from "@/lib/env";

const LISTINGS_IDENTIFIER_TYPE_MAP: Record<
  IdentifierType,
  SearchListingsItemsIdentifiersTypeEnum
> = {
  EAN: SearchListingsItemsIdentifiersTypeEnum.Ean,
  UPC: SearchListingsItemsIdentifiersTypeEnum.Upc,
  GTIN: SearchListingsItemsIdentifiersTypeEnum.Gtin,
};

interface PriceCandidate {
  currency: string | null;
  listingPrice: number | null;
  shippingPrice: number;
  landedPrice: number | null;
  buyBoxWinner: boolean;
  isFulfilledByAmazon: boolean;
}

interface FeeEstimatePayload {
  payload?: {
    FeesEstimateResult?: {
      Status?: string;
      Error?: {
        Code?: string;
        Message?: string;
      };
      FeesEstimate?: {
        TotalFeesEstimate?: {
          CurrencyCode?: string;
          Amount?: number;
        };
      };
    };
  };
  errors?: Array<{
    code?: string;
    message?: string;
  }>;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function extractPriceCandidates(payload: unknown): PriceCandidate[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const maybeOffers = (payload as { Offers?: unknown }).Offers;

  if (!Array.isArray(maybeOffers)) {
    return [];
  }

  const mappedCandidates = maybeOffers
    .map((offer) => {
      if (!offer || typeof offer !== "object") {
        return null;
      }

      const listing = (offer as { ListingPrice?: { Amount?: unknown; CurrencyCode?: unknown } })
        .ListingPrice;
      const shipping = (offer as { Shipping?: { Amount?: unknown } }).Shipping;

      const listingPrice = numberOrNull(listing?.Amount);
      const shippingPrice = numberOrNull(shipping?.Amount) ?? 0;
      const landedPrice =
        listingPrice !== null ? listingPrice + shippingPrice : null;

      return {
        currency: typeof listing?.CurrencyCode === "string" ? listing.CurrencyCode : null,
        listingPrice,
        shippingPrice,
        landedPrice,
        buyBoxWinner: (offer as { IsBuyBoxWinner?: unknown }).IsBuyBoxWinner === true,
        isFulfilledByAmazon:
          (offer as { IsFulfilledByAmazon?: unknown }).IsFulfilledByAmazon === true,
      } satisfies PriceCandidate;
    })
    .filter((candidate): candidate is PriceCandidate => candidate !== null);

  return mappedCandidates.filter((candidate) => candidate.listingPrice !== null);
}

function pickBestPriceCandidate(candidates: PriceCandidate[]): PriceCandidate | null {
  if (candidates.length === 0) {
    return null;
  }

  const buyBox = candidates.find((candidate) => candidate.buyBoxWinner);
  if (buyBox) {
    return buyBox;
  }

  return [...candidates].sort((a, b) => {
    const aLanded = a.landedPrice ?? Number.POSITIVE_INFINITY;
    const bLanded = b.landedPrice ?? Number.POSITIVE_INFINITY;
    return aLanded - bLanded;
  })[0] ?? null;
}

async function fetchPricingForAsin(asin: string): Promise<{
  pricing?: EnrichedPricingSummary;
  priceCandidate?: PriceCandidate;
}> {
  const env = getEnv();

  const auth = new SellingPartnerApiAuth({
    clientId: env.LWA_CLIENT_ID,
    clientSecret: env.LWA_CLIENT_SECRET,
    refreshToken: env.LWA_REFRESH_TOKEN,
  });

  const pricingClient = new ProductPricingApiClient({
    auth,
    region: env.SP_API_REGION,
    userAgent: env.SP_API_USER_AGENT,
  });

  const response = await pricingClient.getItemOffers({
    marketplaceId: env.SP_API_MARKETPLACE_ID,
    itemCondition: GetItemOffersItemConditionEnum.New,
    asin,
  });

  const payload = response.data.payload;
  const candidates = extractPriceCandidates(payload);
  const best = pickBestPriceCandidate(candidates);

  if (!best) {
    const pricingFallback = await pricingClient.getPricing({
      marketplaceId: env.SP_API_MARKETPLACE_ID,
      itemType: GetPricingItemTypeEnum.Asin,
      asins: [asin],
      itemCondition: GetPricingItemConditionEnum.New,
    });

    const firstPricePayload = pricingFallback.data.payload?.[0];
    const fallbackOffers: OfferType[] = firstPricePayload?.Product?.Offers ?? [];

    const fallbackCandidates: PriceCandidate[] = fallbackOffers
      .map((offer: OfferType) => {
        const buyingPrice = offer.BuyingPrice;
        const listingPrice = numberOrNull(buyingPrice?.ListingPrice?.Amount);
        const shippingPrice = numberOrNull(buyingPrice?.Shipping?.Amount) ?? 0;
        const landedPrice =
          numberOrNull(buyingPrice?.LandedPrice?.Amount) ??
          (listingPrice !== null ? listingPrice + shippingPrice : null);

        return {
          currency:
            typeof buyingPrice?.ListingPrice?.CurrencyCode === "string"
              ? buyingPrice.ListingPrice.CurrencyCode
              : null,
          listingPrice,
          shippingPrice,
          landedPrice,
          buyBoxWinner: false,
          isFulfilledByAmazon: offer.FulfillmentChannel === "Amazon",
        };
      })
      .filter((candidate) => candidate.listingPrice !== null);

    const bestFallback = pickBestPriceCandidate(fallbackCandidates);
    const totalOfferCount =
      firstPricePayload?.Product?.CompetitivePricing?.NumberOfOfferListings?.reduce(
        (sum: number, countByCondition: OfferListingCountType) =>
          sum + (countByCondition.Count ?? 0),
        0,
      ) ?? fallbackCandidates.length;

    if (bestFallback) {
      return {
        pricing: {
          currency: bestFallback.currency,
          listingPrice: bestFallback.listingPrice,
          shippingPrice: bestFallback.shippingPrice,
          landedPrice: bestFallback.landedPrice,
          totalOfferCount,
          buyBoxWinner: false,
        },
        priceCandidate: bestFallback,
      };
    }
  }

  if (!best) {
    return {
      pricing: {
        currency: null,
        listingPrice: null,
        shippingPrice: null,
        landedPrice: null,
        totalOfferCount: payload?.Summary?.TotalOfferCount ?? 0,
        buyBoxWinner: false,
      },
      priceCandidate: undefined,
    };
  }

  return {
    pricing: {
      currency: best.currency,
      listingPrice: best.listingPrice,
      shippingPrice: best.shippingPrice,
      landedPrice: best.landedPrice,
      totalOfferCount: payload?.Summary?.TotalOfferCount ?? candidates.length,
      buyBoxWinner: best.buyBoxWinner,
    },
    priceCandidate: best,
  };
}

async function fetchFeesEstimateForAsin(
  asin: string,
  priceCandidate: PriceCandidate | undefined,
): Promise<EnrichedFeesSummary> {
  if (!priceCandidate || priceCandidate.listingPrice === null) {
    return {
      status: "unavailable",
      message: "No price available to estimate fees",
    };
  }

  const env = getEnv();

  const auth = new SellingPartnerApiAuth({
    clientId: env.LWA_CLIENT_ID,
    clientSecret: env.LWA_CLIENT_SECRET,
    refreshToken: env.LWA_REFRESH_TOKEN,
  });

  const accessToken = await auth.getAccessToken();
  const endpoint = sellingPartnerRegions[env.SP_API_REGION].endpoints.production;

  const response = await fetch(
    `${endpoint}/products/fees/v0/items/${encodeURIComponent(asin)}/feesEstimate`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-amz-access-token": accessToken,
        "user-agent": env.SP_API_USER_AGENT,
      },
      body: JSON.stringify({
        FeesEstimateRequest: {
          MarketplaceId: env.SP_API_MARKETPLACE_ID,
          IsAmazonFulfilled: priceCandidate.isFulfilledByAmazon,
          Identifier: `fee-estimate-${asin}`,
          PriceToEstimateFees: {
            ListingPrice: {
              CurrencyCode: priceCandidate.currency,
              Amount: priceCandidate.listingPrice,
            },
            Shipping: {
              CurrencyCode: priceCandidate.currency,
              Amount: priceCandidate.shippingPrice ?? 0,
            },
          },
        },
      }),
    },
  );

  const payload = (await response.json()) as FeeEstimatePayload;

  if (!response.ok) {
    const upstreamError = payload.errors?.[0];
    const message = upstreamError?.message ?? "Fees API request failed";

    throw new Error(message);
  }

  const feeResult = payload.payload?.FeesEstimateResult;
  const totalFees = feeResult?.FeesEstimate?.TotalFeesEstimate;

  if (typeof totalFees?.Amount === "number") {
    return {
      status: "estimated",
      currency: totalFees.CurrencyCode,
      totalFees: totalFees.Amount,
    };
  }

  return {
    status: "unavailable",
    message: feeResult?.Error?.Message ?? "No fee estimate returned",
  };
}

async function findSellerSkuByIdentifier(
  ean: string,
  identifiersType: IdentifierType,
  asin: string,
): Promise<{
  sellerSku?: string;
  fbmQuantity?: number;
  source: EnrichedStockSummary["source"];
}> {
  const env = getEnv();

  if (!env.SP_API_SELLER_ID) {
    return {
      source: "none",
    };
  }

  const auth = new SellingPartnerApiAuth({
    clientId: env.LWA_CLIENT_ID,
    clientSecret: env.LWA_CLIENT_SECRET,
    refreshToken: env.LWA_REFRESH_TOKEN,
  });

  const listingsClient = new ListingsItemsApiClient({
    auth,
    region: env.SP_API_REGION,
    userAgent: env.SP_API_USER_AGENT,
  });

  const response = await listingsClient.searchListingsItems({
    sellerId: env.SP_API_SELLER_ID,
    marketplaceIds: [env.SP_API_MARKETPLACE_ID],
    identifiers: [ean],
    identifiersType: LISTINGS_IDENTIFIER_TYPE_MAP[identifiersType],
    includedData: [
      SearchListingsItemsIncludedDataEnum.Summaries,
      SearchListingsItemsIncludedDataEnum.FulfillmentAvailability,
    ],
    pageSize: 20,
  });

  const items: ListingsItem[] = response.data.items ?? [];

  const bestMatch =
    items.find((item: ListingsItem) =>
      (item.summaries ?? []).some((summary) => summary.asin === asin),
    ) ?? items[0];

  if (!bestMatch?.sku) {
    return {
      source: "listings_search",
    };
  }

  const fbmQuantity = (bestMatch.fulfillmentAvailability ?? []).reduce(
    (sum, channel) => sum + (channel.quantity ?? 0),
    0,
  );

  return {
    sellerSku: bestMatch.sku,
    fbmQuantity,
    source: "listings_search",
  };
}

async function fetchStockBySellerSku(
  sellerSku: string,
  asin: string,
): Promise<Pick<EnrichedStockSummary, "fbaFulfillableQuantity" | "fbaTotalQuantity">> {
  const env = getEnv();

  const auth = new SellingPartnerApiAuth({
    clientId: env.LWA_CLIENT_ID,
    clientSecret: env.LWA_CLIENT_SECRET,
    refreshToken: env.LWA_REFRESH_TOKEN,
  });

  const inventoryClient = new FbaInventoryApiClient({
    auth,
    region: env.SP_API_REGION,
    userAgent: env.SP_API_USER_AGENT,
  });

  const response = await inventoryClient.getInventorySummaries({
    granularityType: GetInventorySummariesGranularityTypeEnum.Marketplace,
    granularityId: env.SP_API_MARKETPLACE_ID,
    marketplaceIds: [env.SP_API_MARKETPLACE_ID],
    details: true,
    sellerSku,
  });

  const summaries: InventorySummary[] = response.data.payload?.inventorySummaries ?? [];
  const summary =
    summaries.find(
      (item: InventorySummary) => item.sellerSku === sellerSku && item.asin === asin,
    ) ??
    summaries.find((item: InventorySummary) => item.sellerSku === sellerSku) ??
    summaries[0];

  return {
    fbaFulfillableQuantity: summary?.inventoryDetails?.fulfillableQuantity,
    fbaTotalQuantity: summary?.totalQuantity,
  };
}

export async function enrichCatalogResult(params: {
  asin: string;
  ean: string;
  identifiersType: IdentifierType;
  sellerSku?: string;
}): Promise<EnrichedCatalogData> {
  const warnings: string[] = [];

  const enrichment: EnrichedCatalogData = {
    asin: params.asin,
    warnings,
  };

  let priceCandidate: PriceCandidate | undefined;

  try {
    const pricingResult = await fetchPricingForAsin(params.asin);
    enrichment.pricing = pricingResult.pricing;
    priceCandidate = pricingResult.priceCandidate;
  } catch {
    warnings.push("Unable to fetch pricing data");
  }

  try {
    enrichment.fees = await fetchFeesEstimateForAsin(params.asin, priceCandidate);
  } catch {
    warnings.push("Unable to fetch fees estimate");
    enrichment.fees = {
      status: "unavailable",
      message: "Fees estimate request failed",
    };
  }

  let sellerSku = params.sellerSku;
  let fbmQuantity: number | undefined;
  let source: EnrichedStockSummary["source"] = params.sellerSku
    ? "seller_sku"
    : "none";

  if (!sellerSku) {
    try {
      const listingMatch = await findSellerSkuByIdentifier(
        params.ean,
        params.identifiersType,
        params.asin,
      );

      sellerSku = listingMatch.sellerSku;
      fbmQuantity = listingMatch.fbmQuantity;
      source = listingMatch.source;
    } catch {
      warnings.push("Unable to map EAN to seller SKU for stock lookup");
    }
  }

  if (!sellerSku) {
    enrichment.stock = {
      status: "unavailable",
      source,
      message:
        "Seller SKU not available. Pass ?sku=YOUR_SKU or set SP_API_SELLER_ID for automatic lookup.",
    };

    return enrichment;
  }

  try {
    const fba = await fetchStockBySellerSku(sellerSku, params.asin);

    enrichment.stock = {
      status: "available",
      source,
      sellerSku,
      fbmQuantity,
      fbaFulfillableQuantity: fba.fbaFulfillableQuantity,
      fbaTotalQuantity: fba.fbaTotalQuantity,
    };
  } catch {
    warnings.push("Unable to fetch FBA inventory for seller SKU");
    enrichment.stock = {
      status: "unavailable",
      source,
      sellerSku,
      fbmQuantity,
      message: "FBA inventory lookup failed",
    };
  }

  return enrichment;
}
