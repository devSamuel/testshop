import { describe, expect, it } from "vitest";
import {
  centsToDecimal,
  formatCents,
  formatMoney,
  formatScaled,
  InvalidAmountError,
  multiplyCents,
  parseCents,
  parseScaled,
  sumCents,
  tryParseCents,
} from "./money";

describe("parseCents", () => {
  it.each([
    ["19.99", 1999],
    ["0.1", 10],
    ["0.10", 10],
    ["1000", 100000],
    ["0", 0],
    ["0.01", 1],
    [" 12.5 ", 1250],
    ["007.05", 705],
    ["-3.25", -325],
  ])("parses %s as %i cents", (input, expected) => {
    expect(parseCents(input)).toBe(expected);
  });

  it("is exact where floating point math is not", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(parseCents("0.1") + parseCents("0.2")).toBe(parseCents("0.3"));
    expect(tryParseCents("19.99")).toBe(1999);
  });

  it.each([
    "",
    "abc",
    "1.2.3",
    "1e3",
    "12.345",
    ".5",
    "5.",
    "$5",
    "1,000",
    "NaN",
    "Infinity",
    "--1",
  ])("rejects %j", (input) => {
    expect(tryParseCents(input)).toBeNull();
    expect(() => parseCents(input)).toThrow(InvalidAmountError);
  });

  it("rejects amounts beyond the safe integer range", () => {
    expect(tryParseCents("90071992547409.92")).toBeNull();
  });
});

describe("parseScaled / formatScaled", () => {
  it("round-trips weights with three decimals", () => {
    expect(parseScaled("0.25", 3)).toBe(250);
    expect(formatScaled(250, 3)).toBe("0.250");
    expect(formatScaled(1200, 3)).toBe("1.200");
  });

  it("formats negative and small values", () => {
    expect(formatScaled(-5, 2)).toBe("-0.05");
    expect(formatScaled(7, 0)).toBe("7");
  });
});

describe("cents arithmetic", () => {
  it("multiplies by whole quantities", () => {
    expect(multiplyCents(1999, 3)).toBe(5997);
    expect(() => multiplyCents(1999, 1.5)).toThrow(RangeError);
  });

  it("sums without drift", () => {
    const tenCents = Array.from({ length: 10 }, () => parseCents("0.10"));
    expect(sumCents(tenCents)).toBe(100);
    expect(sumCents([])).toBe(0);
  });

  it("converts cents back to a decimal string", () => {
    expect(centsToDecimal(4028)).toBe("40.28");
    expect(centsToDecimal(5)).toBe("0.05");
    expect(centsToDecimal(100000)).toBe("1000.00");
  });
});

describe("formatting", () => {
  it("formats cents as US dollars", () => {
    expect(formatCents(1999)).toBe("$19.99");
    expect(formatCents(129999)).toBe("$1,299.99");
    expect(formatCents(0)).toBe("$0.00");
  });

  it("formats API decimal strings", () => {
    expect(formatMoney("40.28")).toBe("$40.28");
    expect(formatMoney("1000")).toBe("$1,000.00");
  });

  it("falls back to the raw value when it cannot be parsed", () => {
    expect(formatMoney("n/a")).toBe("n/a");
  });

  it("supports other currencies", () => {
    expect(formatCents(1050, "EUR")).toBe("€10.50");
  });
});
