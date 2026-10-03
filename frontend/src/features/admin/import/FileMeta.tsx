import { Code, Group, Text, Tooltip } from "@mantine/core";
import { IconFingerprint } from "@tabler/icons-react";
import { formatBytes } from "../../../lib/format";

const HASH_PREFIX_LENGTH = 12;

interface FileMetaProps {
  size: number | null | undefined;
  sha256?: string | null;
}

export function FileMeta({ size, sha256 }: FileMetaProps) {
  if ((size === null || size === undefined) && !sha256) return null;
  return (
    <Group gap="xs" wrap="nowrap">
      {size === null || size === undefined ? null : (
        <Text size="sm" c="dimmed">
          {formatBytes(size)}
        </Text>
      )}
      {sha256 ? (
        <Tooltip label={`SHA-256 ${sha256}`} withArrow multiline maw={360}>
          <Group gap={4} wrap="nowrap" tabIndex={0} aria-label={`SHA-256 ${sha256}`}>
            <IconFingerprint size={14} aria-hidden />
            <Code>{sha256.slice(0, HASH_PREFIX_LENGTH)}</Code>
          </Group>
        </Tooltip>
      ) : null}
    </Group>
  );
}
