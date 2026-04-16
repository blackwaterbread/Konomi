"use strict";
const path = require("path");
const root = process.env.LIBWEBP_ROOT || "";
if (!root) {
  process.stderr.write("LIBWEBP_ROOT is not set\n");
  process.exit(1);
}
if (process.platform === "win32") {
  process.stdout.write(
    path.join(root, "lib", "libwebp.lib").replace(/\\/g, "/"),
  );
} else if (process.platform === "darwin") {
  process.stdout.write(path.join(root, "lib", "libwebp.a"));
} else {
  // Linux: link shared library via -lwebp flag
  process.stdout.write("-lwebp");
}
