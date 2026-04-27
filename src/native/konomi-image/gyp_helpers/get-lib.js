"use strict";
const path = require("path");
const fs = require("fs");
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

const pngLibDir = path.join(pngRoot, "lib");
const jpegLibDir = path.join(jpegRoot, "lib");

if (process.platform === "win32") {
  // libpng (vcpkg x64-windows-static naming)
  const pngLib = findLib(pngLibDir, [
    "libpng16.lib",
    "libpng16_static.lib",
    "libpng.lib",
  ]);
  // zlib (required for static link of libpng on Windows)
  const zlibLib = findLib(pngLibDir, [
    "zlib.lib",
    "zlibstatic.lib",
    "zlib_static.lib",
  ]);
  // libjpeg-turbo (vcpkg x64-windows-static)
  const jpegLib = findLib(jpegLibDir, [
    "turbojpeg.lib",
    "jpeg.lib",
    "libjpeg.lib",
  ]);
  process.stdout.write(`${pngLib} ${zlibLib} ${jpegLib}`);
} else if (process.platform === "darwin") {
  // macOS: static libraries
  const pngLib = findLib(pngLibDir, ["libpng.a", "libpng16.a"]);
  const jpegLib = findLib(jpegLibDir, ["libturbojpeg.a", "libjpeg.a"]);
  process.stdout.write(`${pngLib} ${jpegLib}`);
} else {
  // Linux: link shared libraries via flags
  process.stdout.write("-lpng -lz -lturbojpeg");
}
