import { resolve } from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "konomi-web/src"),
      "@preload": resolve(__dirname, "konomi-app/preload"),
      "@core": resolve(__dirname, "konomi-core"),
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
