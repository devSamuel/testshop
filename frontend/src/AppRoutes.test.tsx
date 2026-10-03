import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ImportRun,
  InvariantReport,
  Order,
  OutboxStats,
  Product,
  StockMovement,
} from "./api/types";
import { AppRoutes } from "./AppRoutes";
import { CART_STORAGE_KEY } from "./features/cart/CartProvider";
import { jsonResponse, renderWithProviders } from "./test/render";

const product: Product = {
  id: 1,
  sku: "ELEC-1001",
  name: "Wireless Headphones",
  description: "Over-ear",
  category: "Electronics",
  price: "199.99",
  stock: 3,
  weight_kg: "0.250",
  version: 2,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
};

const order: Order = {
  id: 9,
  status: "pending_payment",
  email: "buyer@example.com",
  total: "399.98",
  currency: "USD",
  items: [
    {
      product_id: 1,
      sku: "ELEC-1001",
      name: "Wireless Headphones",
      unit_price: "199.99",
      quantity: 2,
      line_total: "399.98",
    },
  ],
  card_brand: "visa",
  card_last4: "0101",
  payment_ref: null,
  decline_reason: null,
  reservation_expires_at: "2026-10-02T12:10:00Z",
  created_at: "2026-10-02T12:00:00Z",
  updated_at: "2026-10-02T12:00:00Z",
  paid_at: null,
};

const movement: StockMovement = {
  id: 5,
  delta: -2,
  balance_after: 3,
  reason: "reservation",
  reference_type: "order",
  reference_id: "9",
  created_at: "2026-10-02T12:00:00Z",
};

const run: ImportRun = {
  id: "bf7a0626-3f46-4b05-b012-3b7e2a2ff412",
  filename: "products.csv",
  status: "completed",
  dry_run: false,
  source: "api",
  rows_total: 40,
  rows_valid: 32,
  rows_invalid: 8,
  created: 31,
  updated: 0,
  unchanged: 0,
  error_count: 8,
  warning_count: 5,
  failure: null,
  started_at: "2026-10-02T12:00:00Z",
  duration_ms: 68,
  issues_total: 13,
  parent_run_id: "2497decf-a0a3-4362-9d58-b54a23865db6",
  applied_run_id: null,
  file_size: 4096,
  can_apply: false,
};

const invariants: InvariantReport = {
  passed: false,
  checked_at: "2026-10-02T12:00:00Z",
  checks: [
    {
      name: "no_negative_stock",
      description: "Stock is never negative",
      passed: true,
      violations: [],
    },
    {
      name: "ledger_matches_balance",
      description: "products.stock equals the sum of its stock_movements",
      passed: false,
      violations: [{ product_id: "1" }],
    },
  ],
};

const outbox: OutboxStats = {
  pending: 1,
  published: 40,
  dead_lettered: 1,
  oldest_pending_seconds: 75.5,
  recent_failures: [
    {
      id: "6f1c0a4e-0000-4000-8000-000000000000",
      event_type: "orders.OrderPaid",
      aggregate_type: "order",
      aggregate_id: "9",
      attempts: 5,
      last_error: "boom",
      occurred_at: "2026-10-02T12:00:00Z",
      failed_at: "2026-10-02T12:01:00Z",
    },
  ],
};

function fixtureFor(url: string): unknown {
  const path = url.split("?")[0] ?? url;
  const routes: [RegExp, unknown][] = [
    [/^\/api\/products$/, { items: [product], total: 1, page: 1, page_size: 24, fuzzy: true }],
    [/^\/api\/products\/\d+\/stock-movements$/, [movement]],
    [/^\/api\/products\/\d+$/, product],
    [/^\/api\/categories$/, [{ id: 1, name: "Electronics", product_count: 1 }]],
    [/^\/api\/orders$/, { items: [order], total: 1, page: 1, page_size: 20 }],
    [/^\/api\/orders\/\d+$/, order],
    [/^\/api\/imports$/, [run]],
    [/^\/api\/admin\/invariants$/, invariants],
    [/^\/api\/admin\/outbox$/, outbox],
    [
      /^\/api\/admin\/alerts$/,
      [
        {
          id: 1,
          product_id: 1,
          sku: "ELEC-1001",
          level: "low",
          stock_at_alert: 3,
          threshold: 5,
          created_at: "2026-10-02T12:00:00Z",
          resolved_at: null,
        },
      ],
    ],
    [
      /^\/api\/admin\/notifications$/,
      [
        {
          id: 1,
          order_id: 9,
          kind: "order_paid",
          recipient: "buyer@example.com",
          subject: "Your order #9 is confirmed",
          created_at: "2026-10-02T12:00:00Z",
        },
      ],
    ],
    [/^\/readyz$/, { status: "ok", database: "up" }],
  ];
  return routes.find(([pattern]) => pattern.test(path))?.[1];
}

function stubApi() {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>((input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const body = fixtureFor(url);
      return Promise.resolve(
        body === undefined ? jsonResponse({}, { status: 404 }) : jsonResponse(body),
      );
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("routes", () => {
  it.each([
    ["/", "Shop", "Wireless Headphones"],
    ["/products/1", "Wireless Headphones", "Add to cart"],
    ["/cart", "Your cart", "Your cart is empty"],
    ["/orders", "Orders", "#9"],
    ["/orders/9", "Order #9", "Confirming payment…"],
    ["/admin/products", "Products", "ELEC-1001"],
    ["/admin/products/1/history", "Wireless Headphones", "Order #9"],
    ["/admin/import", "Import products", "Recent runs"],
    ["/admin/system", "System health", "Ledger matches balance"],
    ["/does-not-exist", "Page not found", "Back to the shop"],
  ])("renders %s", async (route, heading, content) => {
    stubApi();
    renderWithProviders(<AppRoutes />, { route });
    expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
    expect((await screen.findAllByText(content)).length).toBeGreaterThan(0);
  });

  it("renders a filled cart with the checkout panel", async () => {
    stubApi();
    window.localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify({
        lines: [
          {
            productId: 1,
            sku: "ELEC-1001",
            name: "Wireless Headphones",
            unitPrice: "199.99",
            stock: 3,
            quantity: 2,
          },
        ],
      }),
    );
    renderWithProviders(<AppRoutes />, { route: "/cart" });
    expect(await screen.findByRole("heading", { level: 2, name: "Checkout" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /pay \$399\.98/i })).toBeEnabled();
    expect(screen.getByLabelText("Quantity for Wireless Headphones")).toHaveValue("2");
    expect(screen.getByText("Prices and stock are re-validated at checkout.")).toBeInTheDocument();
  });

  it("shows the fuzzy-match banner and the low-stock badge in the shop", async () => {
    stubApi();
    renderWithProviders(<AppRoutes />, { route: "/?q=hedphones" });
    expect(
      await screen.findByText("Showing approximate matches for “hedphones”"),
    ).toBeInTheDocument();
    expect(screen.getByText("Only 3 left")).toBeInTheDocument();
  });
});
