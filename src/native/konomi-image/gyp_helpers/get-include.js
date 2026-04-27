"use strict";
const path = require("path");
const pngRoot = process.env.LIBPNG_ROOT || "";
const jpegRoot = process.env.LIBJPEG_ROOT || "";
if (!pngRoot) {
  process.stderr.write("LIBPNG_ROOT is not set\n");
  process.exit(1);
}
if (!jpegRoot) {
  process.stderr.write("LIBJPEG_ROOT is not set\n");
  process.exit(1);
}
const pngInc = path.join(pngRoot, "include").replace(/\\/g, "/");
const jpegInc = path.join(jpegRoot, "include").replace(/\\/g, "/");
// node-gyp <!@(...) splits on whitespace
process.stdout.write(`${pngInc} ${jpegInc}`);
