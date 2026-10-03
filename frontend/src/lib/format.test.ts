import { describe, expect, it } from "vitest";
import { formatBytes, formatDuration, formatMilliseconds, humanize, shortId } from "./format";

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [512, "512 B"],
    [1536, "1.5 KB"],
    [12_690_000, "12.1 MB"],
    [200 * 1024 * 1024, "200.0 MB"],
    [3 * 1024 ** 3, "3.0 GB"],
  ])("formats %i bytes as %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });

  it("handles missing values", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(-1)).toBe("—");
  });
});

describe("other formatters", () => {
  it("formats durations and identifiers", () => {
    expect(formatDuration(75.5)).toBe("1m 15s");
    expect(formatMilliseconds(42)).toBe("42 ms");
    expect(formatMilliseconds(1530)).toBe("1.5 s");
    expect(shortId("2497decf-a0a3-4362")).toBe("2497decf");
    expect(humanize("ledger_matches_balance")).toBe("Ledger matches balance");
  });
});
