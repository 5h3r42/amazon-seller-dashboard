import type { Item } from "@sp-api-sdk/catalog-items-api-2022-04-01";

import type { LookupResultItem } from "@/lib/catalog/types";

const MAX_IMAGES = 5;

export function normalizeCatalogItem(item: Item): LookupResultItem {
  const summary = item.summaries?.[0];

  const productType =
    item.productTypes?.[0]?.productType ?? summary?.itemClassification ?? null;

  const allImages = (item.images ?? [])
    .flatMap((byMarketplace) => byMarketplace.images)
    .map((image) => image.link)
    .filter((link): link is string => Boolean(link));

  const images = Array.from(new Set(allImages)).slice(0, MAX_IMAGES);

  return {
    asin: item.asin,
    title: summary?.itemName ?? null,
    productType,
    ...(summary?.brand ? { brand: summary.brand } : {}),
    ...(images.length > 0 ? { images } : {}),
  };
}

export function normalizeCatalogItems(items: Item[]): LookupResultItem[] {
  return items.map(normalizeCatalogItem);
}
