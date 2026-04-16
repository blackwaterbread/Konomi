"use strict";
const path = require("path");
const fs = require("fs");
const root = process.env.LIBPNG_ROOT || "";
if (!root) {
  process.stderr.write("LIBPNG_ROOT is not set\n");
  process.exit(1);
}

function findLib(dir, candidates) {
  for (const name of candidates) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p.replace(/\\/g, "/");
  }
  process.stderr.write(
    `Could not find lib among: ${candidates.join(", ")} in ${dir}\n`,
  );
  process.exit(1);
}

const libDir = path.join(root, "lib");

if (process.platform === "win32") {
  // libpng (vcpkg x64-windows-static naming)
  const pngLib = findLib(libDir, [
    "libpng16.lib",
    "libpng16_static.lib",
    "libpng.lib",
  ]);
  // zlib (required for static link of libpng on Windows)
  const zlibLib = findLib(libDir, [
    "zlib.lib",
    "zlibstatic.lib",
    "zlib_static.lib",
  ]);
  // node-gyp <!@(...) splits on whitespace — two paths → two library entries
  process.stdout.write(`${pngLib} ${zlibLib}`);
} else if (process.platform === "darwin") {
  // macOS: static libpng; zlib is a system library (linked automatically)
  const pngLib = findLib(libDir, ["libpng.a", "libpng16.a"]);
  process.stdout.write(pngLib);
} else {
  // Linux: link shared libraries via flags
  process.stdout.write("-lpng -lz");
}
