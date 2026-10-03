export type DecimalString = string;
export type IsoDateTime = string;

export interface Product {
  id: number;
  sku: string;
  name: string;
  description: string;
  category: string;
  price: DecimalString;
  stock: number;
  weight_kg: DecimalString | null;
  version: number;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface ProductPage extends Page<Product> {
  fuzzy: boolean;
}

export type ProductSort = "relevance" | "name" | "price_asc" | "price_desc" | "newest";

export interface ProductSearchQuery {
  q?: string;
  category?: string;
  min_price?: DecimalString;
  max_price?: DecimalString;
  in_stock?: boolean;
  sort?: ProductSort;
  page?: number;
  page_size?: number;
}

export interface ProductCreateInput {
  sku: string;
  name: string;
  description?: string;
  category?: string;
  price: DecimalString;
  stock?: number;
  weight_kg?: DecimalString | null;
}

export type ProductUpdateInput = Partial<ProductCreateInput> & {
  version: number;
  expected_stock?: number;
};

export interface Category {
  id: number;
  name: string;
  product_count: number;
}

export type MovementReason = "import" | "admin_adjustment" | "reservation" | "reservation_released";

export type MovementReferenceType = "order" | "import_run" | "admin";

export interface StockMovement {
  id: number;
  delta: number;
  balance_after: number;
  reason: MovementReason;
  reference_type: MovementReferenceType | null;
  reference_id: string | null;
  created_at: IsoDateTime;
}

export type ImportStatus = "dry_run" | "running" | "completed" | "rejected" | "failed";

export type IssueSeverity = "error" | "warning";

export interface ImportIssue {
  row: number | null;
  severity: IssueSeverity;
  field: string | null;
  value: string | null;
  message: string;
}

export interface ImportReport {
  run_id: string;
  filename: string;
  status: ImportStatus;
  dry_run: boolean;
  rows_total: number;
  rows_valid: number;
  rows_invalid: number;
  created: number;
  updated: number;
  unchanged: number;
  duplicates: number;
  blank_rows: number;
  error_count: number;
  warning_count: number;
  duration_ms: number;
  failure: string | null;
  issues: ImportIssue[];
  issues_total: number;
  preview_limit: number;
  issues_truncated: boolean;
  can_apply: boolean;
  issues_report_url: string;
  parent_run_id: string | null;
  applied_run_id?: string | null;
  file_size: number | null;
  file_sha256: string | null;
}

export interface ImportRun {
  id: string;
  filename: string;
  status: ImportStatus;
  dry_run: boolean;
  source: string;
  rows_total: number;
  rows_valid: number;
  rows_invalid: number;
  created: number;
  updated: number;
  unchanged: number;
  error_count: number;
  warning_count: number;
  issues_total: number;
  failure: string | null;
  started_at: IsoDateTime;
  duration_ms: number | null;
  parent_run_id: string | null;
  applied_run_id: string | null;
  file_size: number | null;
  file_sha256?: string | null;
  can_apply: boolean;
}

export interface ImportRunDetail extends ImportRun {
  issues: ImportIssue[];
  issues_truncated: boolean;
  preview_limit: number;
}

export type OrderStatus = "pending_payment" | "paid" | "payment_failed" | "expired";

export interface OrderItem {
  product_id: number;
  sku: string;
  name: string;
  unit_price: DecimalString;
  quantity: number;
  line_total: DecimalString;
}

export interface Order {
  id: number;
  status: OrderStatus;
  email: string;
  total: DecimalString;
  currency: string;
  items: OrderItem[];
  card_brand: string;
  card_last4: string;
  payment_ref: string | null;
  decline_reason: string | null;
  reservation_expires_at: IsoDateTime;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
  paid_at: IsoDateTime | null;
}

export type OrderPage = Page<Order>;

export interface CheckoutCard {
  number: string;
  exp_month: number;
  exp_year: number;
  cvc: string;
}

export interface CheckoutLine {
  product_id: number;
  quantity: number;
}

export interface CheckoutRequest {
  email: string;
  items: CheckoutLine[];
  card: CheckoutCard;
}

export interface StockShortage {
  product_id: number;
  sku: string | null;
  requested: number;
  available: number;
}

export interface InvariantCheck {
  name: string;
  description: string;
  passed: boolean;
  violations: Record<string, unknown>[];
}

export interface InvariantReport {
  passed: boolean;
  checked_at: IsoDateTime;
  checks: InvariantCheck[];
}

export interface OutboxFailure {
  id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  attempts: number;
  last_error: string | null;
  occurred_at: IsoDateTime;
  failed_at: IsoDateTime | null;
}

export interface OutboxStats {
  pending: number;
  published: number;
  dead_lettered: number;
  oldest_pending_seconds: number | null;
  recent_failures: OutboxFailure[];
}

export type AlertLevel = "low" | "out_of_stock";

export interface StockAlert {
  id: number;
  product_id: number;
  sku: string;
  level: AlertLevel;
  stock_at_alert: number;
  threshold: number;
  created_at: IsoDateTime;
  resolved_at: IsoDateTime | null;
}

export interface OrderNotification {
  id: number;
  order_id: number;
  kind: string;
  recipient: string;
  subject: string;
  created_at: IsoDateTime;
}

export interface ReconcileResult {
  examined: number;
  paid: number;
  failed: number;
  expired: number;
  waiting: number;
  skipped: boolean;
}

export interface Readiness {
  status: string;
  database?: string;
}
