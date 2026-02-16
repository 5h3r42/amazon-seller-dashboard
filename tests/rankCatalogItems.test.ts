import { describe, expect, it } from "vitest";

import type { Item } from "@sp-api-sdk/catalog-items-api-2022-04-01";

import { rankCatalogItemsByIdentifier } from "@/lib/catalog/rankCatalogItems";

describe("rankCatalogItemsByIdentifier", () => {
  it("puts exact identifier matches first", () => {
    const items: Item[] = [
      {
        asin: "B0NOISE001",
        summaries: [{ marketplaceId: "A1F83G8C2ARO7P", itemName: "Noise" }],
        identifiers: [
          {
            marketplaceId: "A1F83G8C2ARO7P",
            identifiers: [{ identifierType: "EAN", identifier: "1234567890123" }],
          },
        ],
      },
      {
        asin: "B0MATCH001",
        summaries: [{ marketplaceId: "A1F83G8C2ARO7P", itemName: "Match" }],
        identifiers: [
          {
            marketplaceId: "A1F83G8C2ARO7P",
            identifiers: [{ identifierType: "EAN", identifier: "4006381333931" }],
          },
        ],
      },
    ];

    const ranked = rankCatalogItemsByIdentifier(items, "4006381333931");

    expect(ranked.results[0]?.asin).toBe("B0MATCH001");
    expect(ranked.exactIdentifierMatches).toBe(1);
  });

  it("drops duplicate ASINs and no-signal rows", () => {
    const items: Item[] = [
      {
        asin: "B0DUPL001",
        summaries: [{ marketplaceId: "A1F83G8C2ARO7P", itemName: "Primary" }],
      },
      {
        asin: "B0DUPL001",
        summaries: [{ marketplaceId: "A1F83G8C2ARO7P", itemName: "Duplicate" }],
      },
      {
        asin: "B0EMPTY001",
      },
    ];

    const ranked = rankCatalogItemsByIdentifier(items, "4006381333931");

    expect(ranked.results).toHaveLength(1);
    expect(ranked.results[0]?.asin).toBe("B0DUPL001");
  });

  it("demotes generic/unknown quality matches when relevance ties", () => {
    const items: Item[] = [
      {
        asin: "B0GENERIC1",
        summaries: [
          {
            marketplaceId: "A1F83G8C2ARO7P",
            itemName: "Generic Kitchen Product",
            brand: "Unknown",
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
        asin: "B0SPECIFIC1",
        summaries: [
          {
            marketplaceId: "A1F83G8C2ARO7P",
            itemName: "STABILO point 88 Fineliner Blue",
            brand: "STABILO",
          },
        ],
        identifiers: [
          {
            marketplaceId: "A1F83G8C2ARO7P",
            identifiers: [{ identifierType: "EAN", identifier: "4006381333931" }],
          },
        ],
      },
    ];

    const ranked = rankCatalogItemsByIdentifier(items, "4006381333931");

    expect(ranked.results[0]?.asin).toBe("B0SPECIFIC1");
  });

  it("boosts dominant product cluster when many exact matches exist", () => {
    const items: Item[] = [
      {
        asin: "B0OUTLIER01",
        summaries: [{ marketplaceId: "A1F83G8C2ARO7P", itemName: "Unrelated exact item", brand: "Brand Z" }],
        productTypes: [{ marketplaceId: "A1F83G8C2ARO7P", productType: "OTHER_CATEGORY" }],
        identifiers: [
          {
            marketplaceId: "A1F83G8C2ARO7P",
            identifiers: [{ identifierType: "EAN", identifier: "4006381333931" }],
          },
        ],
      },
      {
        asin: "B0CORE001",
        summaries: [{ marketplaceId: "A1F83G8C2ARO7P", itemName: "Core Match 1", brand: "STABILO" }],
        productTypes: [{ marketplaceId: "A1F83G8C2ARO7P", productType: "WRITING_INSTRUMENT" }],
        identifiers: [
          {
            marketplaceId: "A1F83G8C2ARO7P",
            identifiers: [{ identifierType: "EAN", identifier: "4006381333931" }],
          },
        ],
      },
      {
        asin: "B0CORE002",
        summaries: [{ marketplaceId: "A1F83G8C2ARO7P", itemName: "Core Match 2", brand: "STABILO" }],
        productTypes: [{ marketplaceId: "A1F83G8C2ARO7P", productType: "WRITING_INSTRUMENT" }],
        identifiers: [
          {
            marketplaceId: "A1F83G8C2ARO7P",
            identifiers: [{ identifierType: "EAN", identifier: "4006381333931" }],
          },
        ],
      },
    ];

    const ranked = rankCatalogItemsByIdentifier(items, "4006381333931");

    expect(ranked.results[0]?.asin).toBe("B0CORE001");
    expect(ranked.results[1]?.asin).toBe("B0CORE002");
  });
});
