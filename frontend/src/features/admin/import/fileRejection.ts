import type { FileRejection } from "@mantine/dropzone";
import { MAX_IMPORT_MB } from "../../../api/imports";

export const CSV_ACCEPT = {
  "text/csv": [".csv"],
  "application/vnd.ms-excel": [".csv"],
  "text/plain": [".csv", ".txt"],
};

export function describeRejection(rejections: FileRejection[]): string {
  const codes = new Set(
    rejections.flatMap((rejection) => rejection.errors.map((error) => error.code)),
  );
  if (codes.has("too-many-files")) return "Please drop a single CSV file.";
  if (codes.has("file-too-large")) return `File is larger than ${MAX_IMPORT_MB} MB.`;
  if (codes.has("file-invalid-type")) return "Only .csv files can be imported.";
  return "That file can't be imported.";
}
