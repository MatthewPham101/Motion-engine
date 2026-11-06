import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    include: ["*-engine/__tests__/**/*.test.{ts,tsx}"],
    setupFiles: ["./test-setup.ts"],
  },
});
