import { afterEach, describe, expect, it, vi } from "vitest";
import { APPLY_RUN_ID, DRY_RUN_ID, importReport } from "../test/importFixtures";
import { jsonResponse, problemResponse } from "../test/render";
import { ApiError } from "./client";
import { importsApi, isImportNotApplicable, isPayloadTooLarge, issuesCsvUrl } from "./imports";

function stubFetch(response: Response) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("importsApi.upload", () => {
  it("posts the file as multipart form data", async () => {
    const fetchMock = stubFetch(jsonResponse(importReport()));
    const file = new File(["sku,name\n"], "catalog.csv", { type: "text/csv" });

    await importsApi.upload(file, true);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/imports?dry_run=true");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeInstanceOf(FormData);
    expect((init?.body as FormData).get("file")).toBeInstanceOf(File);
  });

  it("returns the report carried by a 422 rejection", async () => {
    stubFetch(
      jsonResponse(importReport({ status: "rejected", can_apply: false }), { status: 422 }),
    );
    await expect(importsApi.upload(new File([""], "x.csv"), true)).resolves.toMatchObject({
      status: "rejected",
    });
  });

  it("surfaces a streamed 413 as a payload-too-large error", async () => {
    stubFetch(problemResponse(413, "payload-too-large", { detail: "File is larger than 200 MB" }));
    const error = await importsApi.upload(new File([""], "x.csv"), true).catch((e: unknown) => e);
    expect(isPayloadTooLarge(error)).toBe(true);
    expect((error as ApiError).message).toBe("File is larger than 200 MB");
  });
});

describe("importsApi.apply", () => {
  it("applies the stored dry run without sending a file", async () => {
    const fetchMock = stubFetch(
      jsonResponse(
        importReport({
          run_id: APPLY_RUN_ID,
          status: "completed",
          dry_run: false,
          parent_run_id: DRY_RUN_ID,
        }),
      ),
    );

    const report = await importsApi.apply(DRY_RUN_ID);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`/api/imports/${DRY_RUN_ID}/apply`);
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeUndefined();
    expect(report).toMatchObject({ run_id: APPLY_RUN_ID, parent_run_id: DRY_RUN_ID });
  });

  it("recognises runs that can no longer be applied", async () => {
    stubFetch(problemResponse(409, "import-not-applicable"));
    const error = await importsApi.apply(DRY_RUN_ID).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(isImportNotApplicable(error)).toBe(true);
    expect(isImportNotApplicable(new ApiError(409, "conflict"))).toBe(false);
  });
});

describe("issuesCsvUrl", () => {
  it("builds the full-report URL with an optional severity filter", () => {
    expect(issuesCsvUrl("run-1")).toBe("/api/imports/run-1/issues.csv");
    expect(issuesCsvUrl("run-1", "error")).toBe("/api/imports/run-1/issues.csv?severity=error");
  });

  it("prefers the URL provided by the API", () => {
    expect(issuesCsvUrl("run-1", "warning", "/api/imports/run-1/issues.csv?v=2")).toBe(
      "/api/imports/run-1/issues.csv?v=2&severity=warning",
    );
  });

  it("ignores URLs that do not point at the imports API", () => {
    expect(issuesCsvUrl("run-1", undefined, "javascript:alert(1)")).toBe(
      "/api/imports/run-1/issues.csv",
    );
  });
});
