import { Center, Pagination } from "@mantine/core";

const CONTROL_LABELS = {
  first: "First page",
  previous: "Previous page",
  next: "Next page",
  last: "Last page",
} as const;

interface AppPaginationProps {
  total: number;
  value: number;
  onChange: (page: number) => void;
}

export function AppPagination({ total, value, onChange }: AppPaginationProps) {
  if (total <= 1) return null;
  return (
    <Center mt="xl" component="nav" aria-label="Pagination">
      <Pagination
        total={total}
        value={Math.min(value, total)}
        onChange={onChange}
        getControlProps={(control) => ({ "aria-label": CONTROL_LABELS[control] })}
        getItemProps={(page) => ({
          "aria-label": `Page ${page}`,
          "aria-current": page === value ? "page" : undefined,
        })}
      />
    </Center>
  );
}
