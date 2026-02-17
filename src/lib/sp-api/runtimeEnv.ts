import { ConfigError } from "@/lib/env";
import type { SpApiRegion, SpApiRuntimeEnv } from "@/lib/sp-api/types";

const DEFAULT_USER_AGENT =
  "AmazonSellerDashboard/0.2 (Language=TypeScript; Platform=Node.js)";

function asNonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function getRegion(raw: string | undefined): SpApiRegion {
  const candidate = asNonEmpty(raw);

  if (!candidate) {
    return "eu";
  }

  if (candidate === "na" || candidate === "eu" || candidate === "fe") {
    return candidate;
  }

  throw new ConfigError("SP_API_REGION must be one of: na, eu, fe");
}

export function getSpApiRuntimeEnv(): SpApiRuntimeEnv {
  return {
    region: getRegion(process.env.SP_API_REGION),
    marketplaceId: asNonEmpty(process.env.SP_API_MARKETPLACE_ID),
    sellerId: asNonEmpty(process.env.SP_API_SELLER_ID),
    clientId: asNonEmpty(process.env.SP_API_CLIENT_ID) ?? asNonEmpty(process.env.LWA_CLIENT_ID),
    clientSecret:
      asNonEmpty(process.env.SP_API_CLIENT_SECRET) ??
      asNonEmpty(process.env.LWA_CLIENT_SECRET),
    refreshToken:
      asNonEmpty(process.env.SP_API_REFRESH_TOKEN) ??
      asNonEmpty(process.env.LWA_REFRESH_TOKEN),
    userAgent: asNonEmpty(process.env.SP_API_USER_AGENT) ?? DEFAULT_USER_AGENT,
    awsAccessKey: asNonEmpty(process.env.SP_API_AWS_ACCESS_KEY),
    awsSecretKey: asNonEmpty(process.env.SP_API_AWS_SECRET_KEY),
    roleArn: asNonEmpty(process.env.SP_API_ROLE_ARN),
  };
}
