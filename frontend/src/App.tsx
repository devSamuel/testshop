import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { BrowserRouter } from "react-router-dom";
import { AppRoutes } from "./AppRoutes";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { CartProvider } from "./features/cart/CartProvider";
import { createQueryClient } from "./lib/queryClient";
import { theme } from "./theme";

export function App() {
  const [queryClient] = useState(createQueryClient);
  return (
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <Notifications position="top-right" limit={4} />
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <CartProvider>
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
          </CartProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </MantineProvider>
  );
}
