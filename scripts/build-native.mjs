/**
 * Native addon build script
 *
 * Prerequisites:
 *   Windows: vcpkg install libwebp:x64-windows-static
 *            set LIBWEBP_ROOT=C:/vcpkg/installed/x64-windows-static
 *   macOS:   brew install webp  (LIBWEBP_ROOT auto-detected)
 *
 * Usage: node scripts/build-native.mjs
 */
import { execSync } from 'child_process';
import { mkdirSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const platform = process.platform;
const arch = process.arch;
const outDir = join(root, 'prebuilds', `${platform}-${arch}`);

// macOS: auto-detect libwebp via brew
if (platform === 'darwin' && !process.env.LIBWEBP_ROOT) {
  const brewPrefix = execSync('brew --prefix webp').toString().trim();
  process.env.LIBWEBP_ROOT = brewPrefix;
  console.log(`LIBWEBP_ROOT=${brewPrefix}`);
}

if (!process.env.LIBWEBP_ROOT) {
  console.error('Error: LIBWEBP_ROOT is not set.');
  console.error('  Windows: set LIBWEBP_ROOT=C:/vcpkg/installed/x64-windows-static');
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

const nativeDir = join(root, 'src', 'native', 'webp-alpha');
process.chdir(nativeDir);

console.log(`Building webp-alpha for ${platform}-${arch}...`);
execSync('node-gyp rebuild', { stdio: 'inherit' });

const src = join('build', 'Release', 'webp_alpha.node');
const dest = join(outDir, 'webp-alpha.node');
copyFileSync(src, dest);
console.log(`Done: prebuilds/${platform}-${arch}/webp-alpha.node`);
