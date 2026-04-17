import { resolve } from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src/web"),
      "@preload": resolve(__dirname, "src/app/preload"),
      "@core": resolve(__dirname, "src/core"),
    },
  },
  test: {
    name: "backend",
    environment: "node",
    include: ["tests/backend/**/*.test.ts"],
    fileParallelism: false,
    clearMocks: true,
    restoreMocks: true,
  },
});
