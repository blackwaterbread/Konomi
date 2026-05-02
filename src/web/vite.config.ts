import { resolve } from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import pkg from "../../package.json";

const root = resolve(__dirname);
const repoRoot = resolve(__dirname, "../..");

export default defineConfig({
  root,
  publicDir: resolve(root, "public"),
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      "@": resolve(repoRoot, "src/web"),
      "@preload": resolve(repoRoot, "src/app/preload"),
    },
  },
  plugins: [
    // Dev: relax CSP so Vite's inline HMR scripts can run
    {
      name: "konomi:dev-csp",
      apply: "serve",
      transformIndexHtml(html) {
        return html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'");
      },
    },
    tailwindcss(),
    react(),
  ],
  build: {
    outDir: resolve(repoRoot, "out/web"),
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    proxy: {
      // Only proxy actual API calls, not source files under /api/ directory
      "^/api/(?!.*\\.tsx?$)": {
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
