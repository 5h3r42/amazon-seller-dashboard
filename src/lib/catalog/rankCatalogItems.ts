import type { Item } from "@sp-api-sdk/catalog-items-api-2022-04-01";

import { normalizeRawGtin } from "@/lib/gtin";
import type { LookupResultItem } from "@/lib/catalog/types";
import { normalizeCatalogItem } from "@/lib/amazon/normalizeCatalogItem";

export interface RankedCatalogItems {
  results: LookupResultItem[];
  exactIdentifierMatches: number;
}

interface CandidateResult {
  normalized: LookupResultItem;
  score: number;
  exactIdentifierMatch: boolean;
}

function findMostFrequent(values: string[]): string | undefined {
  if (values.length === 0) {
    return undefined;
  }

  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  let bestValue: string | undefined;
  let bestCount = 0;

  for (const [value, count] of counts.entries()) {
    if (count > bestCount) {
      bestValue = value;
      bestCount = count;
    }
  }

  return bestValue;
}

function extractNormalizedItemIdentifiers(item: Item): string[] {
  const rawIdentifiers = (item.identifiers ?? []).flatMap((group) =>
    group.identifiers.map((identifier) => identifier.identifier),
  );

  return rawIdentifiers
    .map((identifier) => normalizeRawGtin(identifier ?? ""))
    .filter((identifier) => /^\d+$/.test(identifier));
}

function hasDisplaySignal(item: LookupResultItem): boolean {
  return Boolean(item.title || item.brand || item.productType || item.images?.length);
}

function buildScore(
  normalized: LookupResultItem,
  exactIdentifierMatch: boolean,
  hasIdentifiers: boolean,
): number {
  let score = 0;

  if (exactIdentifierMatch) {
    score += 1000;
  } else if (hasIdentifiers) {
    score -= 250;
  }

  if (normalized.title) {
    score += 60;
  }

  if (normalized.brand) {
    score += 20;
  }

  if (normalized.images?.length) {
    score += 15;
  }

  if (normalized.productType) {
    score += 10;
  }

  const title = normalized.title?.toLowerCase() ?? "";
  const brand = normalized.brand?.toLowerCase() ?? "";

  if (normalized.title && normalized.title.length >= 5 && normalized.title.length <= 90) {
    score += 10;
  }

  if (title.includes("generic")) {
    score -= 80;
  }

  if (brand === "unknown" || brand === "generic") {
    score -= 40;
  }

  return score;
}

export function rankCatalogItemsByIdentifier(items: Item[], ean: string): RankedCatalogItems {
  const normalizedTarget = normalizeRawGtin(ean);
  const seenAsins = new Set<string>();

  const candidates: CandidateResult[] = [];

  for (const item of items) {
    if (!item.asin || seenAsins.has(item.asin)) {
      continue;
    }

    seenAsins.add(item.asin);

    const normalized = normalizeCatalogItem(item);

    if (!hasDisplaySignal(normalized)) {
      continue;
    }

    const normalizedIdentifiers = extractNormalizedItemIdentifiers(item);
    const exactIdentifierMatch = normalizedIdentifiers.includes(normalizedTarget);
    const hasIdentifiers = normalizedIdentifiers.length > 0;

    candidates.push({
      normalized,
      exactIdentifierMatch,
      score: buildScore(normalized, exactIdentifierMatch, hasIdentifiers),
    });
  }

  const exactMatches = candidates.filter((candidate) => candidate.exactIdentifierMatch);
  const consensusPool = exactMatches.length > 0 ? exactMatches : candidates;

  const dominantProductType = findMostFrequent(
    consensusPool
      .map((candidate) => candidate.normalized.productType)
      .filter((productType): productType is string => Boolean(productType)),
  );

  const dominantBrand = findMostFrequent(
    consensusPool
      .map((candidate) => candidate.normalized.brand?.toLowerCase())
      .filter(
        (brand): brand is string =>
          Boolean(brand) && brand !== "unknown" && brand !== "generic",
      ),
  );

  for (const candidate of candidates) {
    if (
      dominantProductType &&
      candidate.normalized.productType === dominantProductType &&
      candidate.exactIdentifierMatch
    ) {
      candidate.score += 120;
    }

    if (
      dominantBrand &&
      candidate.normalized.brand?.toLowerCase() === dominantBrand &&
      candidate.exactIdentifierMatch
    ) {
      candidate.score += 80;
    }
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    const aTitle = a.normalized.title ?? "";
    const bTitle = b.normalized.title ?? "";
    return aTitle.localeCompare(bTitle);
  });

  return {
    results: candidates.map((candidate) => candidate.normalized),
    exactIdentifierMatches: candidates.filter((candidate) => candidate.exactIdentifierMatch)
      .length,
  };
}
