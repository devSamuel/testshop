import { Anchor, type MantineSize } from "@mantine/core";
import type { ReactNode } from "react";

interface RunLinkProps {
  runId: string;
  onView: (runId: string) => void;
  children: ReactNode;
  label?: string;
  size?: MantineSize;
}

export function RunLink({ runId, onView, children, label, size = "sm" }: RunLinkProps) {
  return (
    <Anchor
      component="button"
      type="button"
      size={size}
      onClick={() => onView(runId)}
      aria-label={label}
    >
      {children}
    </Anchor>
  );
}
