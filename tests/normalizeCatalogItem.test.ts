import { describe, expect, it } from "vitest";

import type { Item } from "@sp-api-sdk/catalog-items-api-2022-04-01";

import { normalizeCatalogItem } from "@/lib/amazon/normalizeCatalogItem";

describe("normalizeCatalogItem", () => {
  it("maps item fields and deduplicates image URLs", () => {
    const item: Item = {
      asin: "B0TEST1234",
      summaries: [
        {
          marketplaceId: "ATVPDKIKX0DER",
          itemName: "Demo Product",
          brand: "Demo Brand",
          itemClassification: "BASE_PRODUCT",
        },
      ],
      productTypes: [
        {
          marketplaceId: "ATVPDKIKX0DER",
          productType: "HOME",
        },
      ],
      images: [
        {
          marketplaceId: "ATVPDKIKX0DER",
          images: [
            {
              variant: "MAIN",
              link: "https://example.com/image-1.jpg",
              height: 1200,
              width: 1200,
            },
            {
              variant: "PT01",
              link: "https://example.com/image-1.jpg",
              height: 1200,
              width: 1200,
            },
            {
              variant: "PT02",
              link: "https://example.com/image-2.jpg",
              height: 1200,
              width: 1200,
            },
          ],
        },
      ],
    };

    expect(normalizeCatalogItem(item)).toEqual({
      asin: "B0TEST1234",
      title: "Demo Product",
      productType: "HOME",
      brand: "Demo Brand",
      images: [
        "https://example.com/image-1.jpg",
        "https://example.com/image-2.jpg",
      ],
    });
  });

  it("handles sparse payloads", () => {
    const item = {
      asin: "B0SPARSE001",
    } as Item;

    expect(normalizeCatalogItem(item)).toEqual({
      asin: "B0SPARSE001",
      title: null,
      productType: null,
    });
  });

  it("falls back to summary classification when productType is missing", () => {
    const item: Item = {
      asin: "B0CLASS001",
      summaries: [
        {
          marketplaceId: "ATVPDKIKX0DER",
          itemClassification: "OTHER",
        },
      ],
    };

    expect(normalizeCatalogItem(item).productType).toBe("OTHER");
  });
});
