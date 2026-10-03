import { CloseButton, TextInput, type TextInputProps } from "@mantine/core";
import { useDebouncedCallback } from "@mantine/hooks";
import { useState, type KeyboardEvent } from "react";

export const DEFAULT_DEBOUNCE_MS = 300;

interface DebouncedTextInputProps extends Omit<TextInputProps, "value" | "onChange" | "error"> {
  value: string;
  onCommit: (value: string) => void;
  delay?: number;
  validate?: (value: string) => string | null;
  clearLabel?: string;
}

export function DebouncedTextInput({
  value,
  onCommit,
  delay = DEFAULT_DEBOUNCE_MS,
  validate,
  clearLabel,
  onKeyDown,
  ...props
}: DebouncedTextInputProps) {
  const [draft, setDraft] = useState(value);
  const [committed, setCommitted] = useState(value);

  if (value !== committed) {
    setCommitted(value);
    setDraft(value);
  }

  const error = draft ? validate?.(draft) : null;

  const commit = useDebouncedCallback((next: string) => {
    if (next && validate?.(next)) return;
    onCommit(next);
  }, delay);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") commit.flush();
    onKeyDown?.(event);
  };

  const clear = () => {
    commit.cancel();
    setDraft("");
    onCommit("");
  };

  return (
    <TextInput
      {...props}
      value={draft}
      error={error}
      onKeyDown={handleKeyDown}
      onChange={(event) => {
        const next = event.currentTarget.value;
        setDraft(next);
        commit(next);
      }}
      rightSection={
        clearLabel && draft ? (
          <CloseButton size="sm" aria-label={clearLabel} onClick={clear} />
        ) : (
          props.rightSection
        )
      }
    />
  );
}
