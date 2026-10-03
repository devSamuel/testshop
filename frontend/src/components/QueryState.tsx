import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ErrorState } from "./ErrorState";
import { LoadingState } from "./LoadingState";

interface QueryStateProps<T> {
  query: UseQueryResult<T>;
  loading?: ReactNode;
  errorTitle?: string;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  children: (data: T) => ReactNode;
}

export function QueryState<T>({
  query,
  loading,
  errorTitle,
  isEmpty,
  empty,
  children,
}: QueryStateProps<T>) {
  if (query.data === undefined) {
    if (query.isError) {
      return (
        <ErrorState title={errorTitle} error={query.error} onRetry={() => void query.refetch()} />
      );
    }
    return loading ?? <LoadingState />;
  }
  if (isEmpty?.(query.data)) return empty ?? null;
  return children(query.data);
}
