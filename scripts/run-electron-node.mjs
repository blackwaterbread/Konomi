import path from "path";
import { spawnSync } from "child_process";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const electronBinary = require("electron");

const [scriptPath, ...args] = process.argv.slice(2);

if (!scriptPath) {
  console.error(
    "Usage: node ./scripts/run-electron-node.mjs <script-path> [...args]",
  );
  process.exit(1);
}

const result = spawnSync(electronBinary, [path.resolve(scriptPath), ...args], {
  stdio: "inherit",
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
  },
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
