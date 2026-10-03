export const LOW_STOCK_THRESHOLD = 5;

export interface StockStatus {
  color: "red" | "orange" | "green";
  label: string;
}

export function stockStatus(stock: number): StockStatus {
  if (stock <= 0) return { color: "red", label: "Out of stock" };
  if (stock < LOW_STOCK_THRESHOLD) return { color: "orange", label: `Only ${stock} left` };
  return { color: "green", label: "In stock" };
}
