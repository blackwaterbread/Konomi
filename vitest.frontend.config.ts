import { resolve } from "path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify("0.0.0-test"),
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src/web"),
      "@preload": resolve(__dirname, "src/app/preload"),
    },
  },
  test: {
    name: "frontend",
    environment: "jsdom",
    setupFiles: ["tests/frontend/setup.ts"],
    include: ["tests/frontend/**/*.test.ts", "tests/frontend/**/*.test.tsx"],
    clearMocks: true,
    restoreMocks: true,
  },
});
