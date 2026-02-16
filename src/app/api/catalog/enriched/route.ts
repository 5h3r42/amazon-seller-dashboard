import { NextResponse } from "next/server";

import { searchCatalogItemsByIdentifier } from "@/lib/amazon/catalogClient";
import { enrichCatalogResult } from "@/lib/amazon/enrichCatalogResult";
import {
  buildLookupCacheKey,
  getLookupCacheValue,
  setLookupCacheValue,
} from "@/lib/catalog/lookupCache";
import { rankCatalogItemsByIdentifier } from "@/lib/catalog/rankCatalogItems";
import type {
  ApiErrorCode,
  EnrichedLookupResponse,
  ErrorResponse,
} from "@/lib/catalog/types";
import { ConfigError, getEnv } from "@/lib/env";
import { InvalidEanError, parseGtin } from "@/lib/gtin";

const MAX_RESULTS = 10;

export const runtime = "nodejs";

function hasUsableEnrichmentData(
  enrichment: Awaited<ReturnType<typeof enrichCatalogResult>> | undefined,
): boolean {
  if (!enrichment) {
    return false;
  }

  const hasPricing =
    typeof enrichment.pricing?.listingPrice === "number" &&
    Number.isFinite(enrichment.pricing.listingPrice);
  const hasStock = enrichment.stock?.status === "available";

  return hasPricing || hasStock;
}

function buildErrorResponse(
  status: number,
  code: ApiErrorCode,
  message: string,
): NextResponse<ErrorResponse> {
  return NextResponse.json(
    {
      error: {
        code,
        message,
      },
    },
    { status },
  );
}

function getUpstreamStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const maybeStatus = (error as { status?: unknown }).status;
  if (typeof maybeStatus === "number") {
    return maybeStatus;
  }

  const responseStatus = (error as { response?: { status?: unknown } }).response
    ?.status;

  return typeof responseStatus === "number" ? responseStatus : undefined;
}

interface UpstreamErrorInfo {
  status?: number;
  code?: string;
  message?: string;
  requestId?: string;
}

function getUpstreamErrorInfo(error: unknown): UpstreamErrorInfo {
  if (!error || typeof error !== "object") {
    return {};
  }

  const status = getUpstreamStatus(error);
  const response = (error as { response?: unknown }).response as
    | {
        data?: unknown;
        headers?: Record<string, unknown>;
      }
    | undefined;

  const headers = response?.headers;
  const requestIdRaw =
    headers?.["x-amzn-requestid"] ??
    headers?.["x-amzn-request-id"] ??
    headers?.["x-amz-request-id"];

  const requestId =
    typeof requestIdRaw === "string"
      ? requestIdRaw
      : Array.isArray(requestIdRaw) && typeof requestIdRaw[0] === "string"
        ? requestIdRaw[0]
        : undefined;

  const upstreamPayload = response?.data as
    | {
        errors?: Array<{ code?: unknown; message?: unknown }>;
      }
    | undefined;

  const firstError = upstreamPayload?.errors?.[0];

  return {
    status,
    code: firstError && typeof firstError.code === "string" ? firstError.code : undefined,
    message:
      firstError && typeof firstError.message === "string"
        ? firstError.message
        : undefined,
    requestId,
  };
}

function buildUpstreamFailureMessage(info: UpstreamErrorInfo): string {
  const baseMessage = "Amazon Catalog API request failed";

  if (process.env.NODE_ENV === "production") {
    return baseMessage;
  }

  const details: string[] = [];

  if (typeof info.status === "number") {
    details.push(`status=${info.status}`);
  }
  if (info.code) {
    details.push(`code=${info.code}`);
  }
  if (info.message) {
    details.push(`message=${info.message}`);
  }
  if (info.requestId) {
    details.push(`requestId=${info.requestId}`);
  }

  return details.length > 0
    ? `${baseMessage} (${details.join(", ")})`
    : baseMessage;
}

export async function GET(
  request: Request,
): Promise<NextResponse<EnrichedLookupResponse | ErrorResponse>> {
  const requestUrl = new URL(request.url);
  const ean = requestUrl.searchParams.get("ean");
  const skuParam = requestUrl.searchParams.get("sku")?.trim() || undefined;
  const forceRefresh = requestUrl.searchParams.get("refresh") === "1";

  if (!ean) {
    return buildErrorResponse(400, "INVALID_EAN", "Missing ean query parameter");
  }

  try {
    const parsed = parseGtin(ean);
    const env = getEnv();

    const baseCacheKey = buildLookupCacheKey({
      ean: parsed.ean,
      identifiersType: parsed.identifiersType,
      marketplaceId: env.SP_API_MARKETPLACE_ID,
      region: env.SP_API_REGION,
    });

    let cacheHit = false;
    let catalogResponse = forceRefresh
      ? undefined
      : getLookupCacheValue<Awaited<ReturnType<typeof searchCatalogItemsByIdentifier>>>(
          baseCacheKey,
        );

    if (!catalogResponse) {
      catalogResponse = await searchCatalogItemsByIdentifier(
        parsed.ean,
        parsed.identifiersType,
      );
      setLookupCacheValue(baseCacheKey, catalogResponse);
    } else {
      cacheHit = true;
    }

    const ranked = rankCatalogItemsByIdentifier(catalogResponse.items, parsed.ean);
    const results = ranked.results.slice(0, MAX_RESULTS);

    let enrichment = undefined;

    if (results.length > 0) {
      const topAsin = results[0].asin;
      const enrichmentCacheKey = `${baseCacheKey}:enriched:${topAsin}:${skuParam ?? ""}`;
      let candidate = forceRefresh
        ? undefined
        : getLookupCacheValue<Awaited<ReturnType<typeof enrichCatalogResult>>>(
            enrichmentCacheKey,
          );

      if (candidate && !hasUsableEnrichmentData(candidate)) {
        candidate = undefined;
      }

      if (!candidate) {
        candidate = await enrichCatalogResult({
          asin: topAsin,
          ean: parsed.ean,
          identifiersType: parsed.identifiersType,
          sellerSku: skuParam,
        });

        if (hasUsableEnrichmentData(candidate)) {
          setLookupCacheValue(enrichmentCacheKey, candidate);
        }
      }

      enrichment = candidate;
    }

    const payload: EnrichedLookupResponse = {
      input: { ean: parsed.ean },
      results,
      ...(enrichment ? { enrichment } : {}),
    };

    if (process.env.NODE_ENV !== "production") {
      payload.debug = {
        marketplaceId: catalogResponse.marketplaceId,
        region: catalogResponse.region,
        identifiersType: parsed.identifiersType,
        cacheHit,
        rawResults: catalogResponse.items.length,
        rankedResults: ranked.results.length,
        exactIdentifierMatches: ranked.exactIdentifierMatches,
        ...(catalogResponse.upstreamRequestId
          ? { upstreamRequestId: catalogResponse.upstreamRequestId }
          : {}),
      };
    }

    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    if (error instanceof InvalidEanError) {
      return buildErrorResponse(400, "INVALID_EAN", error.message);
    }

    if (error instanceof ConfigError) {
      return buildErrorResponse(500, "CONFIG_ERROR", error.message);
    }

    const upstreamInfo = getUpstreamErrorInfo(error);

    if (upstreamInfo.status === 429) {
      return buildErrorResponse(
        429,
        "AMAZON_RATE_LIMITED",
        "Amazon Catalog API rate limit exceeded",
      );
    }

    if (upstreamInfo.status) {
      return buildErrorResponse(
        502,
        "AMAZON_UPSTREAM_ERROR",
        buildUpstreamFailureMessage(upstreamInfo),
      );
    }

    return buildErrorResponse(
      500,
      "INTERNAL_ERROR",
      "Unexpected server error",
    );
  }
}
