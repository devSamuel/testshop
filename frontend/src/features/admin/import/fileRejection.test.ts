import type { FileRejection } from "@mantine/dropzone";
import { describe, expect, it } from "vitest";
import { describeRejection } from "./fileRejection";

function rejection(name: string, code: string): FileRejection {
  return { file: new File(["x"], name), errors: [{ code, message: code }] };
}

describe("describeRejection", () => {
  it("explains that only CSV files can be imported", () => {
    expect(describeRejection([rejection("photo.png", "file-invalid-type")])).toBe(
      "Only .csv files can be imported.",
    );
  });

  it("reports the file count and size before the type", () => {
    expect(
      describeRejection([
        rejection("a.png", "file-invalid-type"),
        rejection("b.csv", "too-many-files"),
      ]),
    ).toBe("Please drop a single CSV file.");
    expect(describeRejection([rejection("huge.csv", "file-too-large")])).toMatch(/larger than/);
  });
});
