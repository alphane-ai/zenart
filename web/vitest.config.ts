import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": new URL(".", import.meta.url).pathname
    }
  },
  test: {
    environment: "jsdom",
    exclude: ["tests/**/*.spec.ts", "node_modules/**", ".next/**"],
    globals: true,
    setupFiles: ["./vitest.setup.ts"]
  }
});
