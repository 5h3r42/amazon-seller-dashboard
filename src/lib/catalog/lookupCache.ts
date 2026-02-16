import type { IdentifierType, SpApiRegion } from "@/lib/catalog/types";

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry<TValue> {
  value: TValue;
  expiresAt: number;
}

interface CacheKeyParts {
  ean: string;
  identifiersType: IdentifierType;
  marketplaceId: string;
  region: SpApiRegion;
}

const lookupCache = new Map<string, CacheEntry<unknown>>();

export function buildLookupCacheKey(parts: CacheKeyParts): string {
  return [parts.region, parts.marketplaceId, parts.identifiersType, parts.ean].join(":");
}

export function getLookupCacheValue<TValue>(key: string): TValue | undefined {
  const entry = lookupCache.get(key);

  if (!entry) {
    return undefined;
  }

  if (Date.now() > entry.expiresAt) {
    lookupCache.delete(key);
    return undefined;
  }

  return entry.value as TValue;
}

export function setLookupCacheValue<TValue>(
  key: string,
  value: TValue,
  ttlMs = DEFAULT_CACHE_TTL_MS,
): void {
  lookupCache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

export function clearLookupCache(): void {
  lookupCache.clear();
}
