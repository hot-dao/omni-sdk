import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    coverage: {
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts"],
    },
  },
  resolve: {
    alias: {
      "^(\\.{1,2}/.*)\\.js$": "$1",
    },
  },
});
