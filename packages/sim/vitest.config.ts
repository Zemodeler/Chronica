import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // A month of the real world is half a second of engine time on 6,000 provinces, and a test that walks a year, on a machine
    // that is busy, needs more than the default five seconds.
    testTimeout: 30_000,
  },
});
