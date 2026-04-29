import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.mjs"],
    // Tests that write to ~/.playwright-cli/sites.json must not run
    // concurrently with tests that read loadSites() across file boundaries.
    fileParallelism: false,
  },
});
