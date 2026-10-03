import { useQuery } from "@tanstack/react-query";
import { productsApi } from "../../api/products";
import { queryKeys } from "../../api/queryKeys";

export function useCategories() {
  return useQuery({
    queryKey: queryKeys.categories,
    queryFn: ({ signal }) => productsApi.categories(signal),
    staleTime: 60_000,
  });
}
