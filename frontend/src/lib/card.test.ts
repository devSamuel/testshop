import { describe, expect, it } from "vitest";
import { cardBrand, formatCardNumber, isExpired, isLuhnValid, TEST_CARDS } from "./card";

describe("isLuhnValid", () => {
  it("accepts every test card", () => {
    for (const card of TEST_CARDS) expect(isLuhnValid(card.number)).toBe(true);
  });

  it("accepts formatted numbers", () => {
    expect(isLuhnValid("4242 4242 4242 4242")).toBe(true);
  });

  it.each(["4242424242424241", "1234", "", "4242-4242-4242-424x", "42424242424242424242"])(
    "rejects %j",
    (value) => {
      expect(isLuhnValid(value)).toBe(false);
    },
  );
});

describe("isExpired", () => {
  const now = new Date(2026, 9, 2);

  it("treats the current month as valid", () => {
    expect(isExpired(10, 2026, now)).toBe(false);
  });

  it("detects past months and years", () => {
    expect(isExpired(9, 2026, now)).toBe(true);
    expect(isExpired(12, 2025, now)).toBe(true);
    expect(isExpired(1, 2027, now)).toBe(false);
  });
});

describe("card formatting", () => {
  it("groups digits in fours and drops other characters", () => {
    expect(formatCardNumber("4242424242424242")).toBe("4242 4242 4242 4242");
    expect(formatCardNumber("4242-42a42")).toBe("4242 4242");
  });

  it("detects the brand", () => {
    expect(cardBrand("4242")).toBe("visa");
    expect(cardBrand("5555 5555")).toBe("mastercard");
    expect(cardBrand("2221 0000")).toBe("mastercard");
    expect(cardBrand("3782")).toBe("amex");
    expect(cardBrand("6011")).toBe("card");
  });
});
