import { SellingPartnerApiAuth } from "@sp-api-sdk/auth";
import {
  CatalogItemsApiClient,
  SearchCatalogItemsIdentifiersTypeEnum,
  SearchCatalogItemsIncludedDataEnum,
  type Item,
} from "@sp-api-sdk/catalog-items-api-2022-04-01";

import type { IdentifierType, SpApiRegion } from "@/lib/catalog/types";
import { getEnv } from "@/lib/env";

const IDENTIFIER_TYPE_MAP: Record<
  IdentifierType,
  SearchCatalogItemsIdentifiersTypeEnum
> = {
  EAN: SearchCatalogItemsIdentifiersTypeEnum.Ean,
  UPC: SearchCatalogItemsIdentifiersTypeEnum.Upc,
  GTIN: SearchCatalogItemsIdentifiersTypeEnum.Gtin,
};

const INCLUDED_DATA: SearchCatalogItemsIncludedDataEnum[] = [
  SearchCatalogItemsIncludedDataEnum.Summaries,
  SearchCatalogItemsIncludedDataEnum.ProductTypes,
  SearchCatalogItemsIncludedDataEnum.Images,
  SearchCatalogItemsIncludedDataEnum.Identifiers,
];

export interface CatalogLookupPayload {
  items: Item[];
  marketplaceId: string;
  region: SpApiRegion;
  upstreamRequestId?: string;
}

function extractRequestId(
  headers: Record<string, unknown> | undefined,
): string | undefined {
  if (!headers) {
    return undefined;
  }

  const maybeRequestId =
    headers["x-amzn-requestid"] ??
    headers["x-amzn-request-id"] ??
    headers["x-amz-request-id"];

  if (typeof maybeRequestId === "string") {
    return maybeRequestId;
  }

  if (Array.isArray(maybeRequestId)) {
    const first = maybeRequestId[0];
    return typeof first === "string" ? first : undefined;
  }

  return undefined;
}

export async function searchCatalogItemsByIdentifier(
  ean: string,
  identifiersType: IdentifierType,
): Promise<CatalogLookupPayload> {
  const env = getEnv();

  const auth = new SellingPartnerApiAuth({
    clientId: env.LWA_CLIENT_ID,
    clientSecret: env.LWA_CLIENT_SECRET,
    refreshToken: env.LWA_REFRESH_TOKEN,
  });

  const client = new CatalogItemsApiClient({
    auth,
    region: env.SP_API_REGION,
    userAgent: env.SP_API_USER_AGENT,
  });

  const response = await client.searchCatalogItems({
    marketplaceIds: [env.SP_API_MARKETPLACE_ID],
    identifiers: [ean],
    identifiersType: IDENTIFIER_TYPE_MAP[identifiersType],
    includedData: INCLUDED_DATA,
    pageSize: 20,
  });

  return {
    items: response.data.items ?? [],
    marketplaceId: env.SP_API_MARKETPLACE_ID,
    region: env.SP_API_REGION,
    upstreamRequestId: extractRequestId(
      response.headers as Record<string, unknown> | undefined,
    ),
  };
}
