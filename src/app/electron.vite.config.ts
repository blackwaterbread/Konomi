import { resolve } from "path";
import { builtinModules } from "module";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import pkg from "../../package.json";

const appVersion = JSON.stringify(pkg.version);

// Packages that must remain external (native addons or complex runtime deps)
const externalPackages = [
  "better-sqlite3",
  "@prisma/client",
  "@prisma/adapter-better-sqlite3",
];
const useStandaloneReactDevTools = process.env.KONOMI_REACT_DEVTOOLS === "1";

function standaloneReactDevToolsPlugin() {
  return {
    name: "konomi:standalone-react-devtools",
    apply: "serve" as const,
    transformIndexHtml: {
      order: "pre" as const,
      handler(html: string) {
        if (!useStandaloneReactDevTools) return html;

        return {
          html: html.replace(
            "script-src 'self';",
            "script-src 'self' http://localhost:8097;",
          ),
          tags: [
            {
              tag: "script",
              attrs: { src: "http://localhost:8097" },
              injectTo: "head-prepend" as const,
            },
          ],
        };
      },
    },
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ include: externalPackages })],
    resolve: {
      alias: {
        "@": resolve("src/web"),
        "@core": resolve("src/core"),
      },
    },
    build: {
      rollupOptions: {
        external: (id: string) => {
          if (id === "electron") return true;
          if (builtinModules.includes(id) || id.startsWith("node:"))
            return true;
          return externalPackages.some(
            (pkg) => id === pkg || id.startsWith(pkg + "/"),
          );
        },
        input: {
          index: resolve("src/app/main/index.ts"),
          "nai.worker": resolve("src/core/lib/nai.worker.ts"),
          "phash.worker": resolve("src/core/lib/phash.worker.ts"),
          "bench-scan-worker": resolve("src/app/main/lib/bench-scan-worker.ts"),
          utility: resolve("src/app/main/utility.ts"),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ include: externalPackages })],
    build: {
      rollupOptions: {
        input: resolve("src/app/preload/index.ts"),
      },
    },
  },
  renderer: {
    root: resolve("src/app/renderer"),
    publicDir: resolve("src/web/public"),
    define: {
      __APP_VERSION__: appVersion,
    },
    resolve: {
      alias: {
        "@": resolve("src/web"),
        "@preload": resolve("src/app/preload"),
      },
    },
    build: {
      rollupOptions: {
        input: resolve("src/app/renderer/index.html"),
      },
    },
    plugins: [tailwindcss(), standaloneReactDevToolsPlugin(), react()],
  },
});
