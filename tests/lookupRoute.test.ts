import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConfigError } from "@/lib/env";
import { clearLookupCache } from "@/lib/catalog/lookupCache";

const searchCatalogItemsByIdentifierMock = vi.fn();

vi.mock("@/lib/amazon/catalogClient", () => ({
  searchCatalogItemsByIdentifier: (...args: unknown[]) =>
    searchCatalogItemsByIdentifierMock(...args),
}));

import { GET } from "@/app/api/catalog/lookup/route";

describe("GET /api/catalog/lookup", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.SP_API_REGION = "eu";
    process.env.SP_API_MARKETPLACE_ID = "A1F83G8C2ARO7P";
    process.env.LWA_CLIENT_ID = "client-id";
    process.env.LWA_CLIENT_SECRET = "client-secret";
    process.env.LWA_REFRESH_TOKEN = "refresh-token";
    process.env.SP_API_USER_AGENT = "AmazonSellerDashboard/test";
    searchCatalogItemsByIdentifierMock.mockReset();
    clearLookupCache();
  });

  it("returns INVALID_EAN when query param is missing", async () => {
    const response = await GET(new Request("http://localhost/api/catalog/lookup"));
    const payload = (await response.json()) as {
      error: { code: string; message: string };
    };

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("INVALID_EAN");
  });

  it("returns INVALID_EAN when GTIN is invalid", async () => {
    const response = await GET(
      new Request("http://localhost/api/catalog/lookup?ean=1234567"),
    );
    const payload = (await response.json()) as {
      error: { code: string; message: string };
    };

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("INVALID_EAN");
  });

  it("returns normalized results and caps output to top 10", async () => {
    searchCatalogItemsByIdentifierMock.mockResolvedValue({
      items: Array.from({ length: 12 }, (_, index) => ({
        asin: `B0TEST${index.toString().padStart(4, "0")}`,
        summaries: [
          {
            marketplaceId: "ATVPDKIKX0DER",
            itemName: `Product ${index}`,
            brand: "Brand X",
          },
        ],
        productTypes: [
          {
            marketplaceId: "ATVPDKIKX0DER",
            productType: "HOME",
          },
        ],
      })),
      marketplaceId: "ATVPDKIKX0DER",
      region: "na",
      upstreamRequestId: "req-123",
    });

    const response = await GET(
      new Request("http://localhost/api/catalog/lookup?ean=4006381333931"),
    );
    const payload = (await response.json()) as {
      input: { ean: string };
      results: Array<{ asin: string; title: string | null; productType: string | null }>;
      debug?: { marketplaceId: string; region: string; identifiersType: string };
    };

    expect(response.status).toBe(200);
    expect(payload.input.ean).toBe("4006381333931");
    expect(payload.results).toHaveLength(10);
    expect(payload.results[0]).toMatchObject({
      asin: "B0TEST0000",
      title: "Product 0",
      productType: "HOME",
    });
    expect(payload.debug).toMatchObject({
      marketplaceId: "ATVPDKIKX0DER",
      region: "na",
      identifiersType: "EAN",
      cacheHit: false,
    });
  });

  it("prioritizes exact identifier matches", async () => {
    searchCatalogItemsByIdentifierMock.mockResolvedValue({
      items: [
        {
          asin: "B0NOISE001",
          summaries: [{ marketplaceId: "A1F83G8C2ARO7P", itemName: "Noise Item" }],
          identifiers: [
            {
              marketplaceId: "A1F83G8C2ARO7P",
              identifiers: [{ identifierType: "EAN", identifier: "1234567890123" }],
            },
          ],
        },
        {
          asin: "B0EXACT001",
          summaries: [{ marketplaceId: "A1F83G8C2ARO7P", itemName: "Exact Item" }],
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
      upstreamRequestId: "req-priority",
    });

    const response = await GET(
      new Request("http://localhost/api/catalog/lookup?ean=4006381333931"),
    );
    const payload = (await response.json()) as {
      results: Array<{ asin: string }>;
      debug?: { exactIdentifierMatches?: number };
    };

    expect(response.status).toBe(200);
    expect(payload.results[0]?.asin).toBe("B0EXACT001");
    expect(payload.debug?.exactIdentifierMatches).toBe(1);
  });

  it("uses cache for repeated lookups", async () => {
    searchCatalogItemsByIdentifierMock.mockResolvedValue({
      items: [
        {
          asin: "B0CACHE001",
          summaries: [{ marketplaceId: "A1F83G8C2ARO7P", itemName: "Cached Item" }],
        },
      ],
      marketplaceId: "A1F83G8C2ARO7P",
      region: "eu",
      upstreamRequestId: "req-cache",
    });

    const firstResponse = await GET(
      new Request("http://localhost/api/catalog/lookup?ean=4006381333931"),
    );
    const firstPayload = (await firstResponse.json()) as {
      debug?: { cacheHit?: boolean };
    };

    const secondResponse = await GET(
      new Request("http://localhost/api/catalog/lookup?ean=4006381333931"),
    );
    const secondPayload = (await secondResponse.json()) as {
      debug?: { cacheHit?: boolean };
    };

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(searchCatalogItemsByIdentifierMock).toHaveBeenCalledTimes(1);
    expect(firstPayload.debug?.cacheHit).toBe(false);
    expect(secondPayload.debug?.cacheHit).toBe(true);
  });

  it("maps upstream 429 status to AMAZON_RATE_LIMITED", async () => {
    const error = new Error("rate limited") as Error & {
      response: { status: number };
    };
    error.response = { status: 429 };
    searchCatalogItemsByIdentifierMock.mockRejectedValue(error);

    const response = await GET(
      new Request("http://localhost/api/catalog/lookup?ean=4006381333931"),
    );
    const payload = (await response.json()) as {
      error: { code: string; message: string };
    };

    expect(response.status).toBe(429);
    expect(payload.error.code).toBe("AMAZON_RATE_LIMITED");
  });

  it("maps upstream non-429 status to AMAZON_UPSTREAM_ERROR", async () => {
    const error = new Error("upstream failure") as Error & {
      response: { status: number };
    };
    error.response = { status: 503 };
    searchCatalogItemsByIdentifierMock.mockRejectedValue(error);

    const response = await GET(
      new Request("http://localhost/api/catalog/lookup?ean=4006381333931"),
    );
    const payload = (await response.json()) as {
      error: { code: string; message: string };
    };

    expect(response.status).toBe(502);
    expect(payload.error.code).toBe("AMAZON_UPSTREAM_ERROR");
  });

  it("maps config errors to CONFIG_ERROR", async () => {
    searchCatalogItemsByIdentifierMock.mockRejectedValue(
      new ConfigError("Missing or invalid environment variables"),
    );

    const response = await GET(
      new Request("http://localhost/api/catalog/lookup?ean=4006381333931"),
    );
    const payload = (await response.json()) as {
      error: { code: string; message: string };
    };

    expect(response.status).toBe(500);
    expect(payload.error.code).toBe("CONFIG_ERROR");
  });

  it("omits debug payload in production", async () => {
    process.env.NODE_ENV = "production";
    searchCatalogItemsByIdentifierMock.mockResolvedValue({
      items: [
        {
          asin: "B0PROD001",
          summaries: [
            {
              marketplaceId: "ATVPDKIKX0DER",
              itemName: "Prod Item",
            },
          ],
        },
      ],
      marketplaceId: "ATVPDKIKX0DER",
      region: "na",
      upstreamRequestId: "req-prod",
    });

    const response = await GET(
      new Request("http://localhost/api/catalog/lookup?ean=4006381333931"),
    );
    const payload = (await response.json()) as {
      debug?: unknown;
    };

    expect(response.status).toBe(200);
    expect(payload.debug).toBeUndefined();
  });
});
