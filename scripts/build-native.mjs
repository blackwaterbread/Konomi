/**
 * Native addon build script
 *
 * Prerequisites:
 *   Windows: vcpkg install libwebp:x64-windows-static libpng:x64-windows-static libjpeg-turbo:x64-windows-static
 *            set LIBWEBP_ROOT=C:/vcpkg/installed/x64-windows-static
 *            set LIBPNG_ROOT=C:/vcpkg/installed/x64-windows-static
 *            set LIBJPEG_ROOT=C:/vcpkg/installed/x64-windows-static
 *   macOS:   brew install webp libpng jpeg-turbo  (roots auto-detected)
 *
 * Usage: node scripts/build-native.mjs
 */
import { execSync } from "child_process";
import { mkdirSync, copyFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const platform = process.platform;
const arch = process.arch;
const outDir = join(root, "prebuilds", `${platform}-${arch}`);

mkdirSync(outDir, { recursive: true });

// ── macOS: auto-detect library roots via brew ─────────────────────────────────

if (platform === "darwin") {
  if (!process.env.LIBWEBP_ROOT) {
    const brewPrefix = execSync("brew --prefix webp").toString().trim();
    process.env.LIBWEBP_ROOT = brewPrefix;
    console.log(`LIBWEBP_ROOT=${brewPrefix}`);
  }
  if (!process.env.LIBPNG_ROOT) {
    const brewPrefix = execSync("brew --prefix libpng").toString().trim();
    process.env.LIBPNG_ROOT = brewPrefix;
    console.log(`LIBPNG_ROOT=${brewPrefix}`);
  }
  if (!process.env.LIBJPEG_ROOT) {
    const brewPrefix = execSync("brew --prefix jpeg-turbo").toString().trim();
    process.env.LIBJPEG_ROOT = brewPrefix;
    console.log(`LIBJPEG_ROOT=${brewPrefix}`);
  }
}

// vcpkg: LIBWEBP_ROOT, LIBPNG_ROOT, and LIBJPEG_ROOT are the same triplet
// directory. If any is set, mirror to the others.
const triplet =
  process.env.LIBWEBP_ROOT ||
  process.env.LIBPNG_ROOT ||
  process.env.LIBJPEG_ROOT ||
  "";
if (triplet) {
  for (const key of ["LIBWEBP_ROOT", "LIBPNG_ROOT", "LIBJPEG_ROOT"]) {
    if (!process.env[key]) {
      process.env[key] = triplet;
      console.log(`${key}=${triplet} (mirrored)`);
    }
  }
}

// ── Build helper ──────────────────────────────────────────────────────────────

function buildAddon({ name, dir, rootEnv, srcNode, destNode }) {
  if (!process.env[rootEnv]) {
    console.warn(`Warning: ${rootEnv} is not set — skipping ${name}.`);
    console.warn(
      `  Windows: set ${rootEnv}=C:/vcpkg/installed/x64-windows-static`,
    );
    return;
  }

  console.log(`\nBuilding ${name} for ${platform}-${arch}...`);
  process.chdir(dir);

  try {
    execSync("node-gyp rebuild", { stdio: "inherit" });
    const src = join("build", "Release", srcNode);
    const dest = join(outDir, destNode);
    copyFileSync(src, dest);
    console.log(`Done: prebuilds/${platform}-${arch}/${destNode}`);
  } catch (err) {
    console.error(`Failed to build ${name}: ${err.message}`);
    process.exitCode = 1;
  }
}

// ── webp-alpha ────────────────────────────────────────────────────────────────

buildAddon({
  name: "webp-alpha",
  dir: join(root, "src", "native", "webp-alpha"),
  rootEnv: "LIBWEBP_ROOT",
  srcNode: "webp_alpha.node",
  destNode: "webp-alpha.node",
});

// ── konomi-image (libpng + DCT pHash + NAI LSB) ───────────────────────────────

buildAddon({
  name: "konomi-image",
  dir: join(root, "src", "native", "konomi-image"),
  rootEnv: "LIBPNG_ROOT",
  srcNode: "konomi_image.node",
  destNode: "konomi-image.node",
});
