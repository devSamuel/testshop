import react from "@vitejs/plugin-react";
import { defineConfig, type ProxyOptions } from "vite";

const apiTarget = process.env.VITE_API_PROXY ?? "http://localhost:8080";

const LONG_REQUEST_MS = 15 * 60 * 1000;

const proxy: Record<string, ProxyOptions> = Object.fromEntries(
  ["/api", "/healthz", "/readyz"].map((path) => [
    path,
    {
      target: apiTarget,
      changeOrigin: true,
      timeout: LONG_REQUEST_MS,
      proxyTimeout: LONG_REQUEST_MS,
    },
  ]),
);

export default defineConfig({
  plugins: [react()],
  server: { proxy },
  preview: { proxy },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "icons", test: /node_modules[\\/]@tabler/, priority: 3 },
            { name: "mantine", test: /node_modules[\\/]@mantine/, priority: 2 },
            { name: "vendor", test: /node_modules/, priority: 1 },
          ],
        },
      },
    },
  },
});
