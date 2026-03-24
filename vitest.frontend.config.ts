import { resolve } from "path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src/renderer/src"),
      "@preload": resolve(__dirname, "src/preload"),
    },
  },
  test: {
    name: "frontend",
    environment: "jsdom",
    setupFiles: ["src/tests/frontend/setup.ts"],
    include: [
      "src/tests/frontend/**/*.test.ts",
      "src/tests/frontend/**/*.test.tsx",
    ],
    clearMocks: true,
    restoreMocks: true,
  },
});
