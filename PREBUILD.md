# Building Native Addons

> **Most contributors don't need this.** Prebuilt binaries for
> `win32-x64`, `darwin-x64`, and `darwin-arm64` are committed to
> [`prebuilds/`](prebuilds/) and resolved automatically at runtime.
> `bun install` + `bun run dev` just works on those platforms — skip this
> document.

Konomi ships two C++ native addons. You only need this guide when:

- Your platform has no prebuilt binary (e.g. Linux, or a future arch), or
- You're modifying the addon C++ sources and need to regenerate `.node`
  files before committing.

| Addon | Source | Purpose |
|-------|--------|---------|
| `webp-alpha` | [`src/native/webp-alpha/`](src/native/webp-alpha/) | WebP alpha-channel decode (libwebp) |
| `konomi-image` | [`src/native/konomi-image/`](src/native/konomi-image/) | PNG decode + DCT pHash + NAI LSB extraction + JPEG encode (libpng + libjpeg-turbo) |

---

## Prerequisites

| Tool | Notes |
|------|-------|
| [Node.js](https://nodejs.org/) 22+ | required by `node-gyp` |
| [Bun](https://bun.sh/) | script runner |
| `node-gyp` | install globally: `npm install -g node-gyp` |
| **Windows** — [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) 2019+ | "Desktop development with C++" workload |
| **Windows** — [vcpkg](https://vcpkg.io/) | libwebp + libpng + libjpeg-turbo (static) |
| **macOS** — [Homebrew](https://brew.sh/) | libwebp + libpng + jpeg-turbo (auto-detected) |
| **Linux** — `libpng-dev`, `libwebp-dev`, `zlib1g-dev`, `libturbojpeg0-dev` | via apt/yum |

---

## Windows

**1. Install libraries via vcpkg (one-time setup):**

```powershell
git clone https://github.com/microsoft/vcpkg.git <YOUR_VCPKG_PATH>
<YOUR_VCPKG_PATH>\bootstrap-vcpkg.bat
<YOUR_VCPKG_PATH>\vcpkg install libwebp:x64-windows-static libpng:x64-windows-static libjpeg-turbo:x64-windows-static
```

**2. Set environment variables (permanent):**

1. Win + R → `sysdm.cpl` → Advanced → Environment Variables
2. Under "User variables", add:
   - `LIBWEBP_ROOT` = `<YOUR_VCPKG_PATH>\installed\x64-windows-static`
   - `LIBPNG_ROOT` = `<YOUR_VCPKG_PATH>\installed\x64-windows-static`
   - `LIBJPEG_ROOT` = `<YOUR_VCPKG_PATH>\installed\x64-windows-static`
3. Restart your terminal after saving

> `set VAR=...` in cmd is session-only and will not persist.

**3. Build:**

```powershell
bun run prebuild:native
```

---

## macOS

**1. Install libraries via Homebrew:**

```bash
brew install webp libpng jpeg-turbo
```

**2. Build (`LIBWEBP_ROOT` / `LIBPNG_ROOT` / `LIBJPEG_ROOT` are auto-detected from brew):**

```bash
bun run prebuild:native
```

---

## Linux

**1. Install libraries (Debian/Ubuntu):**

```bash
sudo apt-get install libpng-dev libwebp-dev zlib1g-dev libturbojpeg0-dev
```

**2. Set roots and build:**

```bash
export LIBPNG_ROOT=/usr
export LIBWEBP_ROOT=/usr
export LIBJPEG_ROOT=/usr
bun run prebuild:native
```

---

## Output

Built binaries land in:

```
prebuilds/
  win32-x64/
    webp-alpha.node
    konomi-image.node
  darwin-x64/
    ...
  darwin-arm64/
    ...
  linux-x64/
    ...
```

Commit the generated `.node` files when updating addon sources.

---

## Runtime Resolution

The JS wrappers — [`src/core/lib/konomi-image.ts`](src/core/lib/konomi-image.ts)
and [`src/core/lib/webp-alpha.ts`](src/core/lib/webp-alpha.ts) — resolve the
addon via `KONOMI_PREBUILDS_PATH` (set by the Electron main process and the
Fastify server on startup), falling back to `<repoRoot>/prebuilds` when unset.

| Context | Source of `KONOMI_PREBUILDS_PATH` |
|---------|-----------------------------------|
| Electron (dev) | [`src/app/main/bridge.ts`](src/app/main/bridge.ts) — `app.getAppPath()/prebuilds` |
| Electron (packaged) | `process.resourcesPath/app.asar.unpacked/prebuilds` |
| Web server | [`src/server/index.ts`](src/server/index.ts) — `<repoRoot>/prebuilds` |
