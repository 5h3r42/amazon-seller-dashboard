import { afterEach, describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret } from "@/lib/security/tokenCrypto";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("tokenCrypto", () => {
  it("encrypts and decrypts using explicit APP_ENCRYPTION_KEY", () => {
    process.env.NODE_ENV = "test";
    process.env.APP_ENCRYPTION_KEY = "primary-key";

    const encrypted = encryptSecret("refresh-token");

    expect(encrypted).not.toBe("refresh-token");
    expect(decryptSecret(encrypted)).toBe("refresh-token");
  });

  it("decrypts payloads encrypted with legacy secrets after key rotation", () => {
    process.env.NODE_ENV = "test";
    process.env.SP_API_CLIENT_SECRET = "legacy-key";
    delete process.env.APP_ENCRYPTION_KEY;

    const legacyEncrypted = encryptSecret("legacy-token");

    process.env.APP_ENCRYPTION_KEY = "new-primary-key";

    expect(decryptSecret(legacyEncrypted)).toBe("legacy-token");
  });

  it("requires APP_ENCRYPTION_KEY outside development/test", () => {
    process.env.NODE_ENV = "production";
    delete process.env.APP_ENCRYPTION_KEY;
    delete process.env.SP_API_CLIENT_SECRET;
    delete process.env.LWA_CLIENT_SECRET;

    expect(() => encryptSecret("token")).toThrow("APP_ENCRYPTION_KEY is required");
  });
});
