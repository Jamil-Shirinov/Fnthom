import { defineConfig } from "vitest/config";

// Keeps Vitest from picking up the extension's root config.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
