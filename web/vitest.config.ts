import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    // The judge tests call a real API and consume its quota, so they are opt-in
    // via RUN_JUDGE_TESTS=1. Everything else is pure and runs on every commit.
    include: ["lib/**/*.test.ts"],
    testTimeout: 120_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // `server-only` is a build-time guard: importing it from a client bundle
      // is a hard error, which is exactly what we want in the app and exactly
      // what stops vitest loading a server module here. Point it at an empty
      // stub so server code is testable. This does NOT weaken the real boundary
      // - Next still resolves the true package during build, so a bad import in
      // application code still fails the build.
      "server-only": path.resolve(__dirname, "test/server-only-stub.ts"),
    },
  },
});
