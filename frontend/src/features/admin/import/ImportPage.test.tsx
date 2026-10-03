import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APPLY_RUN_ID, DRY_RUN_ID, importReport } from "../../../test/importFixtures";
import { jsonResponse, problemResponse, renderWithProviders } from "../../../test/render";
import ImportPage from "./ImportPage";

interface RecordedCall {
  method: string;
  url: string;
  body: unknown;
}

interface Handlers {
  upload: () => Response;
  apply?: () => Response;
}

function stubImportsApi({ upload, apply }: Handlers) {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>((input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? "GET";
      calls.push({ method, url, body: init?.body });
      if (method === "POST" && url.startsWith("/api/imports?")) return Promise.resolve(upload());
      if (method === "POST" && url.endsWith("/apply") && apply) return Promise.resolve(apply());
      if (url.startsWith("/api/imports")) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse({}, { status: 404 }));
    }),
  );
  return calls;
}

function posts(calls: RecordedCall[]): string[] {
  return calls.filter((call) => call.method === "POST").map((call) => call.url);
}

async function uploadCsv() {
  const user = userEvent.setup();
  renderWithProviders(<ImportPage />, { route: "/admin/import" });
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("Dropzone input not found");
  await user.upload(input, new File(["name,sku,price\n"], "catalog.csv", { type: "text/csv" }));
  return user;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ImportPage", () => {
  it("confirms through the apply endpoint without uploading the file again", async () => {
    const calls = stubImportsApi({
      upload: () => jsonResponse(importReport()),
      apply: () =>
        jsonResponse(
          importReport({
            run_id: APPLY_RUN_ID,
            status: "completed",
            dry_run: false,
            can_apply: false,
            parent_run_id: DRY_RUN_ID,
          }),
        ),
    });
    const user = await uploadCsv();

    const confirm = await screen.findByRole("button", { name: /confirm import/i });
    await waitFor(() => expect(confirm).toBeEnabled());
    await user.click(confirm);

    expect(await screen.findByText("Import completed")).toBeInTheDocument();
    expect(screen.getByText(/applied from dry run/i)).toHaveTextContent(DRY_RUN_ID.slice(0, 8));
    expect(posts(calls)).toEqual(["/api/imports?dry_run=true", `/api/imports/${DRY_RUN_ID}/apply`]);
    const applyCall = calls.find((call) => call.url.endsWith("/apply"));
    expect(applyCall?.body).toBeUndefined();
  });

  it("disables confirm when the dry run cannot be applied", async () => {
    const calls = stubImportsApi({
      upload: () => jsonResponse(importReport({ can_apply: false })),
    });
    await uploadCsv();

    expect(await screen.findByText(/can no longer be applied/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /confirm import/i })).toBeDisabled();
    expect(posts(calls)).toEqual(["/api/imports?dry_run=true"]);
  });

  it("explains an expired or already-applied dry run and re-uploads only on request", async () => {
    const calls = stubImportsApi({
      upload: () => jsonResponse(importReport()),
      apply: () => problemResponse(409, "import-not-applicable"),
    });
    const user = await uploadCsv();

    const confirm = await screen.findByRole("button", { name: /confirm import/i });
    await waitFor(() => expect(confirm).toBeEnabled());
    await user.click(confirm);

    expect(await screen.findByText("This dry run can no longer be applied")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /confirm import/i })).toBeDisabled();
    expect(posts(calls)).toEqual(["/api/imports?dry_run=true", `/api/imports/${DRY_RUN_ID}/apply`]);

    await user.click(screen.getByRole("button", { name: /upload again/i }));

    await waitFor(() =>
      expect(posts(calls)).toEqual([
        "/api/imports?dry_run=true",
        `/api/imports/${DRY_RUN_ID}/apply`,
        "/api/imports?dry_run=true",
      ]),
    );
    const reupload = calls.filter((call) => call.method === "POST").at(-1);
    expect((reupload?.body as FormData).get("file")).toHaveProperty("name", "catalog.csv");
  });

  it("shows the size limit message from a 413 response", async () => {
    stubImportsApi({
      upload: () =>
        problemResponse(413, "payload-too-large", { detail: "File is larger than 200 MB" }),
    });
    await uploadCsv();

    expect(await screen.findByText("File too large")).toBeInTheDocument();
    expect(screen.getByText("File is larger than 200 MB")).toBeInTheDocument();
  });
});
