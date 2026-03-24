"use strict";
const path = require("path");
const root = process.env.LIBPNG_ROOT || "";
if (!root) {
  process.stderr.write("LIBPNG_ROOT is not set\n");
  process.exit(1);
}
process.stdout.write(path.join(root, "include").replace(/\\/g, "/"));
