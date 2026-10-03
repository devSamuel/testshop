import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  DEFAULT_FILTERS,
  parseShopFilters,
  shopFiltersToParams,
  type ShopFilters,
} from "./filters";

interface UpdateOptions {
  push?: boolean;
}

export function useShopFilters() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => parseShopFilters(params), [params]);

  const update = useCallback(
    (patch: Partial<ShopFilters>, { push = false }: UpdateOptions = {}) => {
      setParams(
        (current) => shopFiltersToParams({ ...parseShopFilters(current), page: 1, ...patch }),
        { replace: !push },
      );
    },
    [setParams],
  );

  const reset = useCallback(() => {
    setParams(shopFiltersToParams(DEFAULT_FILTERS), { replace: false });
  }, [setParams]);

  return { filters, update, reset };
}
