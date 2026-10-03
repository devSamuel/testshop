const dateTimeFormat = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});
const timeFormat = new Intl.DateTimeFormat("en-US", { timeStyle: "medium" });
const integerFormat = new Intl.NumberFormat("en-US");

function toDate(value: string | number | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateTime(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const date = toDate(value);
  return date ? dateTimeFormat.format(date) : "—";
}

export function formatTime(value: string | number | Date): string {
  const date = toDate(value);
  return date ? timeFormat.format(date) : "—";
}

export function formatCount(value: number): string {
  return integerFormat.format(value);
}

export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds === null || totalSeconds === undefined) return "—";
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function formatMilliseconds(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value < 1000 ? `${value} ms` : `${(Math.round(value / 100) / 10).toFixed(1)} s`;
}

const BYTE_UNITS = ["KB", "MB", "GB", "TB"] as const;

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${BYTE_UNITS[unit] ?? "TB"}`;
}

export function shortId(value: string, length = 8): string {
  return value.slice(0, length);
}

export function humanize(value: string): string {
  const spaced = value.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatCount(count)} ${count === 1 ? singular : plural}`;
}
