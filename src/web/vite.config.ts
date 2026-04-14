import { resolve } from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import pkg from "../../package.json";

const root = resolve(__dirname);
const repoRoot = resolve(__dirname, "../..");

export default defineConfig({
  root,
  publicDir: resolve(repoRoot, "src/app/renderer/public"),
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      "@": resolve(repoRoot, "src/web/src"),
      "@preload": resolve(repoRoot, "src/app/preload"),
    },
  },
  plugins: [tailwindcss(), react()],
  build: {
    outDir: resolve(repoRoot, "out/web"),
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:3000",
        ws: true,
      },
    },
  },
});
