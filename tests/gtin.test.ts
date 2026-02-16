import { describe, expect, it } from "vitest";

import {
  InvalidEanError,
  isValidGtinCheckDigit,
  parseGtin,
} from "@/lib/gtin";

describe("parseGtin", () => {
  it("accepts valid EAN-13 and maps to EAN", () => {
    expect(parseGtin("4006381333931")).toEqual({
      ean: "4006381333931",
      identifiersType: "EAN",
    });
  });

  it("accepts valid UPC-A and maps to UPC", () => {
    expect(parseGtin("036000291452")).toEqual({
      ean: "036000291452",
      identifiersType: "UPC",
    });
  });

  it("accepts valid GTIN-14 and maps to GTIN", () => {
    expect(parseGtin("00012345600012")).toEqual({
      ean: "00012345600012",
      identifiersType: "GTIN",
    });
  });

  it("normalizes spaces and hyphens", () => {
    expect(parseGtin("4006-3813 33931")).toEqual({
      ean: "4006381333931",
      identifiersType: "EAN",
    });
  });

  it("rejects invalid check digit", () => {
    expect(() => parseGtin("4006381333932")).toThrow(InvalidEanError);
  });

  it("rejects non-digit payload", () => {
    expect(() => parseGtin("ABC123")).toThrow(InvalidEanError);
  });

  it("rejects unsupported lengths", () => {
    expect(() => parseGtin("1234567")).toThrow(InvalidEanError);
  });
});

describe("isValidGtinCheckDigit", () => {
  it("returns true for known valid GTIN", () => {
    expect(isValidGtinCheckDigit("73513537")).toBe(true);
  });

  it("returns false for invalid values", () => {
    expect(isValidGtinCheckDigit("9505000000003")).toBe(false);
  });
});
