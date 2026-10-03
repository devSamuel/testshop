import { ApiError, apiFetch, isRecord } from "./client";
import type { ImportReport, ImportRun, ImportRunDetail, IssueSeverity } from "./types";

export const MAX_IMPORT_MB = 200;
export const MAX_IMPORT_BYTES = MAX_IMPORT_MB * 1024 * 1024;

const IMPORTS_PATH = "/api/imports";

function runPath(runId: string): string {
  return `${IMPORTS_PATH}/${encodeURIComponent(runId)}`;
}

function isImportReport(value: unknown): value is ImportReport {
  return isRecord(value) && typeof value.run_id === "string" && Array.isArray(value.issues);
}

async function reportOrThrow(request: Promise<ImportReport>): Promise<ImportReport> {
  try {
    return await request;
  } catch (error) {
    if (error instanceof ApiError && error.status === 422 && isImportReport(error.body)) {
      return error.body;
    }
    throw error;
  }
}

export function issuesCsvUrl(runId: string, severity?: IssueSeverity, reportUrl?: string): string {
  const base = reportUrl?.startsWith(`${IMPORTS_PATH}/`)
    ? reportUrl
    : `${runPath(runId)}/issues.csv`;
  if (!severity) return base;
  const [path = base, search = ""] = base.split("?");
  const params = new URLSearchParams(search);
  params.set("severity", severity);
  return `${path}?${params.toString()}`;
}

export function isImportNotApplicable(error: unknown): boolean {
  return error instanceof ApiError && (error.is("import-not-applicable") || error.status === 404);
}

export function isPayloadTooLarge(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 413 || error.is("payload-too-large"));
}

export const importsApi = {
  upload: (file: File, dryRun: boolean): Promise<ImportReport> => {
    const formData = new FormData();
    formData.append("file", file, file.name);
    return reportOrThrow(
      apiFetch<ImportReport>(IMPORTS_PATH, {
        method: "POST",
        query: { dry_run: dryRun },
        formData,
      }),
    );
  },

  apply: (runId: string): Promise<ImportReport> =>
    reportOrThrow(apiFetch<ImportReport>(`${runPath(runId)}/apply`, { method: "POST" })),

  list: (limit: number, signal?: AbortSignal) =>
    apiFetch<ImportRun[]>(IMPORTS_PATH, { query: { limit }, signal }),

  get: (runId: string, signal?: AbortSignal) =>
    apiFetch<ImportRunDetail>(runPath(runId), { signal }),
};
