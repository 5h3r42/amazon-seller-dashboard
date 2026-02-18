import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const CIPHER_ALGORITHM = "aes-256-gcm";
const ENCRYPTION_VERSION = "v1";
const DEV_FALLBACK_KEY = "dev-only-fallback-key";

function asNonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function getLegacyEncryptionSecrets(): string[] {
  const candidates = [
    asNonEmpty(process.env.SP_API_CLIENT_SECRET),
    asNonEmpty(process.env.LWA_CLIENT_SECRET),
  ].filter((value): value is string => Boolean(value));

  if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") {
    candidates.push(DEV_FALLBACK_KEY);
  }

  return [...new Set(candidates)];
}

function getPrimaryEncryptionSecret(): string {
  const appKey = asNonEmpty(process.env.APP_ENCRYPTION_KEY);
  if (appKey) {
    return appKey;
  }

  if (process.env.NODE_ENV !== "development" && process.env.NODE_ENV !== "test") {
    throw new Error("APP_ENCRYPTION_KEY is required outside development/test.");
  }

  return getLegacyEncryptionSecrets()[0] ?? DEV_FALLBACK_KEY;
}

function deriveEncryptionKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

function decryptWithSecret(payload: string, secret: string): string {
  const [version, ivEncoded, authTagEncoded, encryptedEncoded] = payload.split(".");

  if (
    version !== ENCRYPTION_VERSION ||
    !ivEncoded ||
    !authTagEncoded ||
    !encryptedEncoded
  ) {
    throw new Error("Invalid encrypted token payload");
  }

  const decipher = createDecipheriv(
    CIPHER_ALGORITHM,
    deriveEncryptionKey(secret),
    Buffer.from(ivEncoded, "base64url"),
  );

  decipher.setAuthTag(Buffer.from(authTagEncoded, "base64url"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedEncoded, "base64url")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

export function encryptSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    CIPHER_ALGORITHM,
    deriveEncryptionKey(getPrimaryEncryptionSecret()),
    iv,
  );

  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    ENCRYPTION_VERSION,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptSecret(payload: string): string {
  const secrets = [
    getPrimaryEncryptionSecret(),
    ...getLegacyEncryptionSecrets(),
  ];

  let lastError: unknown;

  for (const secret of [...new Set(secrets)]) {
    try {
      return decryptWithSecret(payload, secret);
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error("Invalid encrypted token payload");
}
