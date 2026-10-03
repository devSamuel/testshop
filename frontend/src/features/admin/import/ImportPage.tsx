import { Alert, Button, Group, Loader, Paper, Progress, Stack, Stepper, Text } from "@mantine/core";
import { Dropzone } from "@mantine/dropzone";
import { notifications } from "@mantine/notifications";
import {
  IconCheck,
  IconClockOff,
  IconFileTypeCsv,
  IconFileUpload,
  IconInfoCircle,
  IconRotateClockwise,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  importsApi,
  isImportNotApplicable,
  isPayloadTooLarge,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_MB,
} from "../../../api/imports";
import { queryKeys } from "../../../api/queryKeys";
import type { ImportReport, ImportRun } from "../../../api/types";
import { ErrorState } from "../../../components/ErrorState";
import { PageHeader } from "../../../components/PageHeader";
import { formatBytes, formatCount } from "../../../lib/format";
import { CSV_ACCEPT, describeRejection } from "./fileRejection";
import { ImportReportView } from "./ImportReportView";
import { RecentRuns } from "./RecentRuns";
import { RunDetailsDrawer } from "./RunDetailsDrawer";

const RECENT_RUNS_LIMIT = 20;
const RUNNING_REFRESH_MS = 2000;

function activeStep(
  preview: ImportReport | null,
  result: ImportReport | null,
  applying: boolean,
): number {
  if (result) return 3;
  if (applying) return 2;
  if (preview) return 1;
  return 0;
}

function hasRunningRun(runs: ImportRun[] | undefined): boolean {
  return runs?.some((run) => run.status === "running") ?? false;
}

function previewSummary(preview: ImportReport): string {
  if (preview.status !== "dry_run") {
    return "This file cannot be imported. Fix the problems above and upload it again.";
  }
  if (preview.rows_valid === 0) return "There are no valid rows to import.";
  if (!preview.can_apply) {
    return "This dry run can no longer be applied: it was already applied or its stored file expired.";
  }
  const skipped =
    preview.rows_invalid > 0
      ? `; ${formatCount(preview.rows_invalid)} invalid rows will be skipped`
      : "";
  return `${formatCount(preview.rows_valid)} valid rows will be imported${skipped}.`;
}

function BusyPanel({ title, detail }: { title: string; detail: string }) {
  return (
    <Paper withBorder radius="md" p="lg" role="status" aria-live="polite">
      <Group gap="md" wrap="nowrap">
        <Loader size="sm" aria-hidden />
        <div>
          <Text fw={600}>{title}</Text>
          <Text size="sm" c="dimmed">
            {detail}
          </Text>
        </div>
      </Group>
      <Progress value={100} animated striped mt="md" aria-hidden />
    </Paper>
  );
}

export default function ImportPage() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportReport | null>(null);
  const [result, setResult] = useState<ImportReport | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);

  const runs = useQuery({
    queryKey: queryKeys.imports.list(RECENT_RUNS_LIMIT),
    queryFn: ({ signal }) => importsApi.list(RECENT_RUNS_LIMIT, signal),
    refetchInterval: (query) => (hasRunningRun(query.state.data) ? RUNNING_REFRESH_MS : false),
  });

  const refreshRuns = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.imports.all });
  };

  const dryRun = useMutation({
    mutationFn: (target: File) => importsApi.upload(target, true),
    onSuccess: (report) => {
      setPreview(report);
      refreshRuns();
    },
  });

  const apply = useMutation({
    mutationFn: (runId: string) => importsApi.apply(runId),
    onSuccess: (report) => {
      setResult(report);
      refreshRuns();
      void queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.categories });
      if (report.status === "completed") {
        notifications.show({
          color: "green",
          title: "Import completed",
          message: `${formatCount(report.created)} created, ${formatCount(report.updated)} updated`,
        });
      }
    },
    onError: refreshRuns,
  });

  const selectFile = (selected: File) => {
    setFile(selected);
    setPreview(null);
    setResult(null);
    setRejection(null);
    apply.reset();
    dryRun.mutate(selected);
  };

  const startOver = () => {
    setFile(null);
    setPreview(null);
    setResult(null);
    setRejection(null);
    dryRun.reset();
    apply.reset();
  };

  const uploadAgain = () => {
    if (file) selectFile(file);
    else startOver();
  };

  const runId = params.get("run");
  const openRun = (id: string) => {
    const next = new URLSearchParams(params);
    next.set("run", id);
    setParams(next);
  };
  const closeRun = () => {
    const next = new URLSearchParams(params);
    next.delete("run");
    setParams(next);
  };

  const report = result ?? preview;
  const notApplicable = apply.isError && isImportNotApplicable(apply.error);
  const canConfirm = preview?.can_apply === true && !notApplicable;
  const showDropzone = !preview && !result && !dryRun.isPending;

  return (
    <>
      <PageHeader
        title="Import products"
        description="Upload a CSV to create or update products in bulk."
      />
      <Stack gap="lg">
        <Alert color="blue" variant="light" icon={<IconInfoCircle aria-hidden />}>
          Dry run validates without saving. Every upload is checked first and nothing changes until
          you confirm the import. Validated files are kept for 24 hours, so confirming does not
          upload the file again.
        </Alert>

        <Stepper
          active={activeStep(preview, result, apply.isPending)}
          size="sm"
          allowNextStepsSelect={false}
        >
          <Stepper.Step label="Upload" description="Choose a CSV file" />
          <Stepper.Step label="Review" description="Dry-run report" />
          <Stepper.Step label="Import" description="Apply changes" />
        </Stepper>

        {showDropzone ? (
          <Dropzone
            onDrop={(files) => {
              const [first] = files;
              if (first) selectFile(first);
            }}
            onReject={(rejections) => setRejection(describeRejection(rejections))}
            maxSize={MAX_IMPORT_BYTES}
            accept={CSV_ACCEPT}
            multiple={false}
            aria-label="Upload a CSV file"
          >
            <Group justify="center" gap="xl" mih={160} style={{ pointerEvents: "none" }}>
              <Dropzone.Accept>
                <IconUpload size={48} stroke={1.5} color="var(--mantine-color-blue-6)" />
              </Dropzone.Accept>
              <Dropzone.Reject>
                <IconX size={48} stroke={1.5} color="var(--mantine-color-red-6)" />
              </Dropzone.Reject>
              <Dropzone.Idle>
                <IconFileTypeCsv size={48} stroke={1.5} color="var(--mantine-color-dimmed)" />
              </Dropzone.Idle>
              <div>
                <Text size="lg" inline>
                  Drag a CSV file here or click to choose one
                </Text>
                <Text size="sm" c="dimmed" mt={8}>
                  Columns: name, sku, description, category, price, stock, weight_kg · up to{" "}
                  {MAX_IMPORT_MB} MB
                </Text>
              </div>
            </Group>
          </Dropzone>
        ) : null}

        {dryRun.isPending ? (
          <BusyPanel
            title="Uploading and validating…"
            detail={`${dryRun.variables.name} · ${formatBytes(dryRun.variables.size)}. Large files can take a few minutes; keep this tab open.`}
          />
        ) : null}

        {rejection ? (
          <Alert color="red" variant="light" withCloseButton onClose={() => setRejection(null)}>
            {rejection}
          </Alert>
        ) : null}

        {dryRun.isError ? (
          <ErrorState
            title={
              isPayloadTooLarge(dryRun.error) ? "File too large" : "The file could not be validated"
            }
            error={dryRun.error}
            onRetry={
              file && !isPayloadTooLarge(dryRun.error) ? () => dryRun.mutate(file) : undefined
            }
          />
        ) : null}

        {report ? (
          <Paper withBorder radius="md" p="md">
            <ImportReportView key={report.run_id} report={report} onViewRun={openRun} />
          </Paper>
        ) : null}

        {notApplicable ? (
          <Alert
            color="orange"
            variant="light"
            icon={<IconClockOff aria-hidden />}
            title="This dry run can no longer be applied"
          >
            <Stack gap="xs">
              <Text size="sm">
                It has already been applied, or its uploaded file expired (validated files are kept
                for 24 hours). Upload the file again to validate it from scratch.
              </Text>
              <Group gap="xs">
                <Button
                  size="xs"
                  color="orange"
                  leftSection={<IconFileUpload size={14} aria-hidden />}
                  onClick={uploadAgain}
                >
                  Upload again
                </Button>
              </Group>
            </Stack>
          </Alert>
        ) : null}

        {apply.isError && !notApplicable && preview ? (
          <ErrorState
            title="The import could not be completed"
            error={apply.error}
            onRetry={() => apply.mutate(preview.run_id)}
          />
        ) : null}

        {apply.isPending ? (
          <BusyPanel
            title="Applying import…"
            detail="Writing the validated rows to the catalog. Large imports can take a few minutes."
          />
        ) : null}

        {preview && !result ? (
          <Paper withBorder radius="md" p="md">
            <Group justify="space-between" gap="md">
              <Text size="sm">{previewSummary(preview)}</Text>
              <Group gap="sm">
                <Button
                  variant="default"
                  leftSection={<IconRotateClockwise size={16} aria-hidden />}
                  onClick={startOver}
                  disabled={apply.isPending}
                >
                  Choose another file
                </Button>
                <Button
                  leftSection={<IconCheck size={16} aria-hidden />}
                  onClick={() => apply.mutate(preview.run_id)}
                  loading={apply.isPending}
                  disabled={!canConfirm}
                >
                  Confirm import
                </Button>
              </Group>
            </Group>
          </Paper>
        ) : null}

        {result ? (
          <Group justify="flex-end">
            <Button
              variant="light"
              leftSection={<IconUpload size={16} aria-hidden />}
              onClick={startOver}
            >
              Import another file
            </Button>
          </Group>
        ) : null}

        <RecentRuns runs={runs} onView={openRun} />
      </Stack>
      <RunDetailsDrawer runId={runId} onClose={closeRun} onView={openRun} />
    </>
  );
}
