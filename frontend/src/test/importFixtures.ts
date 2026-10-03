import type { ImportIssue, ImportReport } from "../api/types";

export const DRY_RUN_ID = "2497decf-a0a3-4362-9d58-b54a23865db6";
export const APPLY_RUN_ID = "bf7a0626-3f46-4b05-b012-3b7e2a2ff412";
export const SHA256 = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

export function importIssue(row: number | null, severity: ImportIssue["severity"]): ImportIssue {
  return {
    row,
    severity,
    field: row === null ? null : "price",
    value: row === null ? null : "abc",
    message: `${severity} on row ${row ?? "file"}`,
  };
}

export function importReport(overrides: Partial<ImportReport> = {}): ImportReport {
  const runId = overrides.run_id ?? DRY_RUN_ID;
  return {
    run_id: runId,
    filename: "catalog.csv",
    status: "dry_run",
    dry_run: true,
    rows_total: 10,
    rows_valid: 8,
    rows_invalid: 2,
    created: 6,
    updated: 2,
    unchanged: 0,
    duplicates: 1,
    blank_rows: 0,
    error_count: 2,
    warning_count: 1,
    duration_ms: 42,
    failure: null,
    issues: [importIssue(null, "warning"), importIssue(3, "error"), importIssue(7, "error")],
    issues_total: 3,
    preview_limit: 1000,
    issues_truncated: false,
    can_apply: true,
    issues_report_url: `/api/imports/${runId}/issues.csv`,
    parent_run_id: null,
    file_size: 12_690_000,
    file_sha256: SHA256,
    ...overrides,
  };
}
