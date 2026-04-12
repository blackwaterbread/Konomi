import { resolve } from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src/renderer/src"),
      "@preload": resolve(__dirname, "src/preload"),
      "@core": resolve(__dirname, "src/core"),
    },
  },
  test: {
    name: "backend",
    environment: "node",
    include: ["src/tests/backend/**/*.test.ts"],
    fileParallelism: false,
    clearMocks: true,
    restoreMocks: true,
  },
});
