"use strict";
// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS script run by node-gyp (`node gyp_helpers/...`)
const path = require("path");
const root = process.env.LIBWEBP_ROOT || "";
if (!root) {
  process.stderr.write("LIBWEBP_ROOT is not set\n");
  process.exit(1);
}
process.stdout.write(path.join(root, "include").replace(/\\/g, "/"));
