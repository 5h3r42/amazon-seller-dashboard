import type { IdentifierType } from "@/lib/catalog/types";

const SUPPORTED_GTIN_LENGTHS = new Set([8, 12, 13, 14]);

export class InvalidEanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidEanError";
  }
}

export function normalizeRawGtin(input: string): string {
  return input.trim().replace(/[\s-]/g, "");
}

export function determineIdentifierType(gtin: string): IdentifierType {
  switch (gtin.length) {
    case 8:
    case 13:
      return "EAN";
    case 12:
      return "UPC";
    case 14:
      return "GTIN";
    default:
      throw new InvalidEanError("EAN/UPC/GTIN must be 8, 12, 13, or 14 digits");
  }
}

export function isValidGtinCheckDigit(gtin: string): boolean {
  if (!/^\d+$/.test(gtin) || gtin.length < 2) {
    return false;
  }

  const body = gtin.slice(0, -1);
  const checkDigit = Number(gtin.at(-1));

  let sum = 0;
  let multiplier = 3;

  for (let index = body.length - 1; index >= 0; index -= 1) {
    sum += Number(body[index]) * multiplier;
    multiplier = multiplier === 3 ? 1 : 3;
  }

  const expectedCheckDigit = (10 - (sum % 10)) % 10;
  return expectedCheckDigit === checkDigit;
}

export function parseGtin(input: string): {
  ean: string;
  identifiersType: IdentifierType;
} {
  const normalized = normalizeRawGtin(input);

  if (!/^\d+$/.test(normalized)) {
    throw new InvalidEanError("EAN/UPC/GTIN must contain digits only");
  }

  if (!SUPPORTED_GTIN_LENGTHS.has(normalized.length)) {
    throw new InvalidEanError("EAN/UPC/GTIN must be 8, 12, 13, or 14 digits");
  }

  if (!isValidGtinCheckDigit(normalized)) {
    throw new InvalidEanError("Invalid EAN/UPC/GTIN check digit");
  }

  return {
    ean: normalized,
    identifiersType: determineIdentifierType(normalized),
  };
}
