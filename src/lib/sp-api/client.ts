import { SellingPartnerApiAuth } from "@sp-api-sdk/auth";
import { FinancesApiClient } from "@sp-api-sdk/finances-api-v0";
import { OrdersApiClient } from "@sp-api-sdk/orders-api-v0";

import type { SpApiConnectionConfig } from "@/lib/sp-api/types";

function buildAuth(config: SpApiConnectionConfig): SellingPartnerApiAuth {
  return new SellingPartnerApiAuth({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    refreshToken: config.refreshToken,
  });
}

export function createOrdersClient(config: SpApiConnectionConfig): OrdersApiClient {
  return new OrdersApiClient({
    auth: buildAuth(config),
    region: config.region,
    userAgent: config.userAgent,
    rateLimiting: {
      retry: true,
    },
  });
}

export function createFinancesClient(
  config: SpApiConnectionConfig,
): FinancesApiClient {
  return new FinancesApiClient({
    auth: buildAuth(config),
    region: config.region,
    userAgent: config.userAgent,
    rateLimiting: {
      retry: true,
    },
  });
}
