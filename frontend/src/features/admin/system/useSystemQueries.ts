import { useQuery } from "@tanstack/react-query";
import { adminApi } from "../../../api/admin";
import { queryKeys } from "../../../api/queryKeys";

export const SYSTEM_REFRESH_MS = 5000;
export const NOTIFICATIONS_LIMIT = 25;

const live = { refetchInterval: SYSTEM_REFRESH_MS, staleTime: 0 } as const;

export function useInvariants() {
  return useQuery({
    queryKey: queryKeys.admin.invariants,
    queryFn: ({ signal }) => adminApi.invariants(signal),
    ...live,
  });
}

export function useOutbox() {
  return useQuery({
    queryKey: queryKeys.admin.outbox,
    queryFn: ({ signal }) => adminApi.outbox(signal),
    ...live,
  });
}

export function useAlerts(includeResolved: boolean) {
  return useQuery({
    queryKey: queryKeys.admin.alerts(includeResolved),
    queryFn: ({ signal }) => adminApi.alerts(includeResolved, signal),
    ...live,
  });
}

export function useNotificationsLog() {
  return useQuery({
    queryKey: queryKeys.admin.notifications(NOTIFICATIONS_LIMIT),
    queryFn: ({ signal }) => adminApi.notifications(NOTIFICATIONS_LIMIT, signal),
    ...live,
  });
}

export function useReadiness() {
  return useQuery({
    queryKey: queryKeys.admin.readiness,
    queryFn: ({ signal }) => adminApi.readiness(signal),
    retry: false,
    ...live,
  });
}
