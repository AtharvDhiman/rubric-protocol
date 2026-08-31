import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    // The judge tests call a real API and cost money, so they are opt-in via
    // RUN_JUDGE_TESTS=1. Everything else is pure and runs on every commit.
    include: ["lib/**/*.test.ts"],
    testTimeout: 120_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
