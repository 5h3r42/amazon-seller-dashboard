import { z } from "zod";

const envSchema = z.object({
  SP_API_REGION: z.enum(["na", "eu", "fe"]),
  SP_API_MARKETPLACE_ID: z.string().trim().min(1),
  SP_API_SELLER_ID: z.string().trim().min(1).optional(),
  LWA_CLIENT_ID: z.string().trim().min(1),
  LWA_CLIENT_SECRET: z.string().trim().min(1),
  LWA_REFRESH_TOKEN: z.string().trim().min(1),
  SP_API_USER_AGENT: z.string().trim().min(1),
});

export type AppEnv = z.infer<typeof envSchema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function getEnv(): AppEnv {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => issue.path.join(".") || "unknown")
      .join(", ");

    throw new ConfigError(`Missing or invalid environment variables: ${details}`);
  }

  return parsed.data;
}
