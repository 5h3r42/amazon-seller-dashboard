import { ConfigError } from "@/lib/env";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/security/tokenCrypto";
import { getSpApiRuntimeEnv } from "@/lib/sp-api/runtimeEnv";
import type { SpApiConnectionConfig } from "@/lib/sp-api/types";

interface ResolveSpApiConfigOptions {
  marketplaceId?: string;
  sellerId?: string;
}

function decodeRefreshToken(value: string): string {
  try {
    return decryptSecret(value);
  } catch {
    return value;
  }
}

export async function resolveSpApiConfig(
  options: ResolveSpApiConfigOptions = {},
): Promise<SpApiConnectionConfig> {
  const runtimeEnv = getSpApiRuntimeEnv();

  const where = {
    ...(options.marketplaceId ? { marketplaceId: options.marketplaceId } : {}),
    ...(options.sellerId ? { sellerId: options.sellerId } : {}),
  };

  const connection = await prisma.amazonConnection.findFirst({
    where: Object.keys(where).length > 0 ? where : undefined,
    orderBy: {
      createdAt: "desc",
    },
  });

  const marketplaceId =
    options.marketplaceId ?? connection?.marketplaceId ?? runtimeEnv.marketplaceId;
  const sellerId = options.sellerId ?? connection?.sellerId ?? runtimeEnv.sellerId;
  const clientId = connection?.lwaClientId ?? runtimeEnv.clientId;
  const clientSecret = runtimeEnv.clientSecret;
  const refreshToken =
    connection?.refreshTokenEncrypted
      ? decodeRefreshToken(connection.refreshTokenEncrypted)
      : runtimeEnv.refreshToken;

  const missing: string[] = [];

  if (!marketplaceId) {
    missing.push("SP_API_MARKETPLACE_ID or saved connection marketplaceId");
  }
  if (!clientId) {
    missing.push("SP_API_CLIENT_ID/LWA_CLIENT_ID or saved connection lwaClientId");
  }
  if (!clientSecret) {
    missing.push("SP_API_CLIENT_SECRET/LWA_CLIENT_SECRET");
  }
  if (!refreshToken) {
    missing.push("SP_API_REFRESH_TOKEN/LWA_REFRESH_TOKEN or saved connection refresh token");
  }

  if (missing.length > 0) {
    throw new ConfigError(`Missing required SP-API config: ${missing.join(", ")}`);
  }

  const resolvedMarketplaceId = marketplaceId as string;
  const resolvedClientId = clientId as string;
  const resolvedClientSecret = clientSecret as string;
  const resolvedRefreshToken = refreshToken as string;

  return {
    connectionId: connection?.id,
    region: runtimeEnv.region,
    marketplaceId: resolvedMarketplaceId,
    sellerId,
    clientId: resolvedClientId,
    clientSecret: resolvedClientSecret,
    refreshToken: resolvedRefreshToken,
    userAgent: runtimeEnv.userAgent,
    awsAccessKey: runtimeEnv.awsAccessKey,
    awsSecretKey: runtimeEnv.awsSecretKey,
    roleArn: runtimeEnv.roleArn,
  };
}
