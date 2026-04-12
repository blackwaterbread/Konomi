"use strict";
const path = require("path");
const root = process.env.LIBWEBP_ROOT || "";
if (!root) {
  process.stderr.write("LIBWEBP_ROOT is not set\n");
  process.exit(1);
}
const lib =
  process.platform === "win32"
    ? path.join(root, "lib", "libwebp.lib").replace(/\\/g, "/")
    : path.join(root, "lib", "libwebp.a");
process.stdout.write(lib);
