import { defineConfig } from "vitest/config";
export default defineConfig({
  server: { port: 1420, strictPort: true },
  clearScreen: false,
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    restoreMocks: true,
    exclude: [
      "**/node_modules/**",
      "**/tests/browser/**",
      "**/scripts/release-tests/**",
    ],
  },
});
