import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearLookupCache } from "@/lib/catalog/lookupCache";

const searchCatalogItemsByIdentifierMock = vi.fn();
const enrichCatalogResultMock = vi.fn();

vi.mock("@/lib/amazon/catalogClient", () => ({
  searchCatalogItemsByIdentifier: (...args: unknown[]) =>
    searchCatalogItemsByIdentifierMock(...args),
}));

vi.mock("@/lib/amazon/enrichCatalogResult", () => ({
  enrichCatalogResult: (...args: unknown[]) => enrichCatalogResultMock(...args),
}));

import { GET } from "@/app/api/catalog/enriched/route";

describe("GET /api/catalog/enriched", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.SP_API_REGION = "eu";
    process.env.SP_API_MARKETPLACE_ID = "A1F83G8C2ARO7P";
    process.env.LWA_CLIENT_ID = "client-id";
    process.env.LWA_CLIENT_SECRET = "client-secret";
    process.env.LWA_REFRESH_TOKEN = "refresh-token";
    process.env.SP_API_USER_AGENT = "AmazonSellerDashboard/test";

    clearLookupCache();
    searchCatalogItemsByIdentifierMock.mockReset();
    enrichCatalogResultMock.mockReset();
  });

  it("returns lookup + enrichment payload", async () => {
    searchCatalogItemsByIdentifierMock.mockResolvedValue({
      items: [
        {
          asin: "B0TEST0001",
          summaries: [
            {
              marketplaceId: "A1F83G8C2ARO7P",
              itemName: "Demo Product",
            },
          ],
          identifiers: [
            {
              marketplaceId: "A1F83G8C2ARO7P",
              identifiers: [{ identifierType: "EAN", identifier: "4006381333931" }],
            },
          ],
        },
      ],
      marketplaceId: "A1F83G8C2ARO7P",
      region: "eu",
      upstreamRequestId: "req-enriched",
    });

    enrichCatalogResultMock.mockResolvedValue({
      asin: "B0TEST0001",
      pricing: {
        currency: "GBP",
        listingPrice: 9.99,
        shippingPrice: 0,
        landedPrice: 9.99,
        totalOfferCount: 3,
        buyBoxWinner: true,
      },
      fees: {
        status: "estimated",
        currency: "GBP",
        totalFees: 2.34,
      },
      stock: {
        status: "available",
        source: "seller_sku",
        sellerSku: "SKU-1",
        fbmQuantity: 5,
        fbaFulfillableQuantity: 10,
        fbaTotalQuantity: 12,
      },
      warnings: [],
    });

    const response = await GET(
      new Request("http://localhost/api/catalog/enriched?ean=4006381333931"),
    );

    const payload = (await response.json()) as {
      input: { ean: string };
      results: Array<{ asin: string }>;
      enrichment?: { asin: string; pricing?: { listingPrice: number } };
      debug?: { cacheHit?: boolean; exactIdentifierMatches?: number };
    };

    expect(response.status).toBe(200);
    expect(payload.input.ean).toBe("4006381333931");
    expect(payload.results[0]?.asin).toBe("B0TEST0001");
    expect(payload.enrichment?.asin).toBe("B0TEST0001");
    expect(payload.enrichment?.asin).toBe(payload.results[0]?.asin);
    expect(payload.enrichment?.pricing?.listingPrice).toBe(9.99);
    expect(payload.debug?.cacheHit).toBe(false);
    expect(payload.debug?.exactIdentifierMatches).toBe(1);
    expect(enrichCatalogResultMock).toHaveBeenCalledTimes(1);
  });

  it("uses cached base and enrichment responses", async () => {
    searchCatalogItemsByIdentifierMock.mockResolvedValue({
      items: [
        {
          asin: "B0CACHE0001",
          summaries: [
            {
              marketplaceId: "A1F83G8C2ARO7P",
              itemName: "Cached Product",
            },
          ],
          identifiers: [
            {
              marketplaceId: "A1F83G8C2ARO7P",
              identifiers: [{ identifierType: "EAN", identifier: "4006381333931" }],
            },
          ],
        },
      ],
      marketplaceId: "A1F83G8C2ARO7P",
      region: "eu",
    });

    enrichCatalogResultMock.mockResolvedValue({
      asin: "B0CACHE0001",
      pricing: {
        currency: "GBP",
        listingPrice: 19.99,
        shippingPrice: 0,
        landedPrice: 19.99,
        totalOfferCount: 1,
        buyBoxWinner: true,
      },
      warnings: [],
    });

    await GET(new Request("http://localhost/api/catalog/enriched?ean=4006381333931"));
    await GET(new Request("http://localhost/api/catalog/enriched?ean=4006381333931"));

    expect(searchCatalogItemsByIdentifierMock).toHaveBeenCalledTimes(1);
    expect(enrichCatalogResultMock).toHaveBeenCalledTimes(1);
  });

  it("enriches only the top-ranked ASIN without fallback", async () => {
    searchCatalogItemsByIdentifierMock.mockResolvedValue({
      items: [
        {
          asin: "B0TOP0001",
          summaries: [
            {
              marketplaceId: "A1F83G8C2ARO7P",
              itemName: "Top Ranked Item",
            },
          ],
          identifiers: [
            {
              marketplaceId: "A1F83G8C2ARO7P",
              identifiers: [{ identifierType: "EAN", identifier: "4006381333931" }],
            },
          ],
        },
        {
          asin: "B0ALT0002",
          summaries: [
            {
              marketplaceId: "A1F83G8C2ARO7P",
              itemName: "Alternative Item",
            },
          ],
          identifiers: [
            {
              marketplaceId: "A1F83G8C2ARO7P",
              identifiers: [{ identifierType: "EAN", identifier: "9999999999999" }],
            },
          ],
        },
      ],
      marketplaceId: "A1F83G8C2ARO7P",
      region: "eu",
    });

    enrichCatalogResultMock.mockImplementation(
      async ({ asin }: { asin: string }) => {
        if (asin === "B0TOP0001") {
          return {
            asin: "B0TOP0001",
            warnings: [],
          };
        }

        return {
          asin: "B0ALT0002",
          pricing: {
            currency: "GBP",
            listingPrice: 18.5,
            shippingPrice: 0,
            landedPrice: 18.5,
            totalOfferCount: 1,
            buyBoxWinner: true,
          },
          warnings: [],
        };
      },
    );

    const response = await GET(
      new Request("http://localhost/api/catalog/enriched?ean=4006381333931"),
    );

    const payload = (await response.json()) as {
      results: Array<{ asin: string }>;
      enrichment?: { asin: string; pricing?: { listingPrice: number } };
    };

    expect(response.status).toBe(200);
    expect(payload.results[0]?.asin).toBe("B0TOP0001");
    expect(payload.enrichment?.asin).toBe("B0TOP0001");
    expect(payload.enrichment?.pricing?.listingPrice).toBeUndefined();
    expect(enrichCatalogResultMock).toHaveBeenCalledTimes(1);
    expect(enrichCatalogResultMock).toHaveBeenCalledWith(
      expect.objectContaining({ asin: "B0TOP0001" }),
    );
  });
});
