import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, renderHook, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { CartProvider } from "../features/cart/CartProvider";
import { theme } from "../theme";

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
}

interface ProviderOptions {
  route?: string;
  queryClient?: QueryClient;
}

function createWrapper({ route = "/", queryClient = createTestQueryClient() }: ProviderOptions) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MantineProvider theme={theme}>
        <QueryClientProvider client={queryClient}>
          <CartProvider>
            <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
          </CartProvider>
        </QueryClientProvider>
      </MantineProvider>
    );
  };
}

export function renderWithProviders(
  ui: ReactElement,
  options: ProviderOptions & Omit<RenderOptions, "wrapper"> = {},
) {
  const { route, queryClient, ...renderOptions } = options;
  return render(ui, { wrapper: createWrapper({ route, queryClient }), ...renderOptions });
}

export function renderHookWithProviders<T>(hook: () => T, options: ProviderOptions = {}) {
  return renderHook(hook, { wrapper: createWrapper(options) });
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function problemResponse(status: number, slug: string, extensions: object = {}): Response {
  return jsonResponse(
    {
      type: `https://errors.shop.local/${slug}`,
      title: slug,
      status,
      detail: `Problem: ${slug}`,
      instance: "/api/test",
      ...extensions,
    },
    { status, headers: { "Content-Type": "application/problem+json" } },
  );
}
