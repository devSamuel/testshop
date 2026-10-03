import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DRY_RUN_ID, importIssue, importReport, SHA256 } from "../../../test/importFixtures";
import { renderWithProviders } from "../../../test/render";
import { ImportReportView } from "./ImportReportView";

const fullReport = `/api/imports/${DRY_RUN_ID}/issues.csv`;

describe("ImportReportView", () => {
  it("shows the file size and a short hash with the full hash available", () => {
    renderWithProviders(<ImportReportView report={importReport()} />);
    expect(screen.getByText("12.1 MB")).toBeInTheDocument();
    expect(screen.getByText(SHA256.slice(0, 12))).toBeInTheDocument();
    expect(screen.getByLabelText(`SHA-256 ${SHA256}`)).toBeInTheDocument();
  });

  it("keeps small reports inline with a filter-aware download link", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ImportReportView report={importReport()} />);

    expect(screen.queryByText(/download the full report/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(4);
    expect(screen.getByRole("link", { name: /download issues csv/i })).toHaveAttribute(
      "href",
      fullReport,
    );

    await user.click(screen.getByText("Errors (2)"));
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.getByRole("link", { name: /download errors csv/i })).toHaveAttribute(
      "href",
      `${fullReport}?severity=error`,
    );
  });

  it("offers the full report in three severities when the preview is truncated", () => {
    const issues = Array.from({ length: 1000 }, (_, index) => importIssue(index + 2, "error"));
    renderWithProviders(
      <ImportReportView
        report={importReport({
          issues,
          issues_total: 25_431,
          error_count: 25_000,
          warning_count: 431,
          issues_truncated: true,
        })}
      />,
    );

    const alert = screen
      .getByText(/showing the first 1,000 of 25,431 issues\. download the full report:/i)
      .closest("[role='alert']");
    expect(alert).not.toBeNull();
    const links = within(alert as HTMLElement).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["All issues", fullReport],
      ["Errors only", `${fullReport}?severity=error`],
      ["Warnings only", `${fullReport}?severity=warning`],
    ]);
    links.forEach((link) => expect(link).toHaveAttribute("download"));
    expect(screen.queryByRole("link", { name: /download issues csv/i })).not.toBeInTheDocument();
  });

  it("explains how repeated SKUs are handled", () => {
    renderWithProviders(<ImportReportView report={importReport({ duplicates: 2 })} />);
    expect(
      screen.getByText(/identical rows are skipped with a warning; conflicting rows are errors/i),
    ).toBeInTheDocument();
  });
});
