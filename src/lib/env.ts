import { z } from "zod";

const regionSchema = z.enum(["na", "eu", "fe"]);

const envSchema = z.object({
  SP_API_REGION: regionSchema.default("eu"),
  SP_API_MARKETPLACE_ID: z.string().trim().min(1),
  SP_API_SELLER_ID: z.string().trim().min(1).optional(),
  SP_API_CLIENT_ID: z.string().trim().min(1).optional(),
  SP_API_CLIENT_SECRET: z.string().trim().min(1).optional(),
  SP_API_REFRESH_TOKEN: z.string().trim().min(1).optional(),
  SP_API_AWS_ACCESS_KEY: z.string().trim().min(1).optional(),
  SP_API_AWS_SECRET_KEY: z.string().trim().min(1).optional(),
  SP_API_ROLE_ARN: z.string().trim().min(1).optional(),
  LWA_CLIENT_ID: z.string().trim().min(1).optional(),
  LWA_CLIENT_SECRET: z.string().trim().min(1).optional(),
  LWA_REFRESH_TOKEN: z.string().trim().min(1).optional(),
  SP_API_USER_AGENT: z
    .string()
    .trim()
    .min(1)
    .default("AmazonSellerDashboard/0.2 (Language=TypeScript; Platform=Node.js)"),
});

type ParsedEnv = z.infer<typeof envSchema>;

export interface AppEnv extends ParsedEnv {
  SP_API_CLIENT_ID: string;
  SP_API_CLIENT_SECRET: string;
  SP_API_REFRESH_TOKEN: string;
  LWA_CLIENT_ID: string;
  LWA_CLIENT_SECRET: string;
  LWA_REFRESH_TOKEN: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function getOptionalEnv(): ParsedEnv {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => issue.path.join(".") || "unknown")
      .join(", ");

    throw new ConfigError(`Missing or invalid environment variables: ${details}`);
  }

  return parsed.data;
}

export function getEnv(): AppEnv {
  const parsed = getOptionalEnv();

  const clientId = parsed.SP_API_CLIENT_ID ?? parsed.LWA_CLIENT_ID;
  const clientSecret = parsed.SP_API_CLIENT_SECRET ?? parsed.LWA_CLIENT_SECRET;
  const refreshToken = parsed.SP_API_REFRESH_TOKEN ?? parsed.LWA_REFRESH_TOKEN;

  const missing: string[] = [];

  if (!clientId) {
    missing.push("SP_API_CLIENT_ID/LWA_CLIENT_ID");
  }
  if (!clientSecret) {
    missing.push("SP_API_CLIENT_SECRET/LWA_CLIENT_SECRET");
  }
  if (!refreshToken) {
    missing.push("SP_API_REFRESH_TOKEN/LWA_REFRESH_TOKEN");
  }

  if (missing.length > 0) {
    throw new ConfigError(`Missing required SP-API credentials: ${missing.join(", ")}`);
  }

  const resolvedClientId = clientId as string;
  const resolvedClientSecret = clientSecret as string;
  const resolvedRefreshToken = refreshToken as string;

  return {
    ...parsed,
    SP_API_CLIENT_ID: resolvedClientId,
    SP_API_CLIENT_SECRET: resolvedClientSecret,
    SP_API_REFRESH_TOKEN: resolvedRefreshToken,
    LWA_CLIENT_ID: resolvedClientId,
    LWA_CLIENT_SECRET: resolvedClientSecret,
    LWA_REFRESH_TOKEN: resolvedRefreshToken,
  };
}
