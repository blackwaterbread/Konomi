# Building the Konomi

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| [Node.js](https://nodejs.org/) | 22+ | |
| [Bun](https://bun.sh/) | latest | Package manager & script runner |
| [Git](https://git-scm.com/) | any | |
| **Windows** — [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) | 2019+ | C++ workload required for native addons |
| **Windows** — [vcpkg](https://vcpkg.io/) | any | For libwebp and libpng static libraries |
| **macOS** — [Homebrew](https://brew.sh/) | any | For libwebp and libpng (auto-detected) |

---

## 1. Clone & Install

```bash
git clone https://github.com/blackwaterbread/Konomi.git
cd Konomi
bun install
```

---

## 2. Build the Native Addons

Konomi uses two C++ native addons. Prebuilt binaries are committed to the
repository under `src/native/prebuilds/`, so this step is only needed when building from
source for the first time, or after modifying addon sources.

| Addon | Source | Purpose |
|-------|--------|---------|
| `webp-alpha` | `src/native/webp-alpha/` | WebP alpha-channel decode (libwebp) |
| `konomi-image` | `src/native/konomi-image/` | PNG decode + DCT pHash + NAI LSB extraction (libpng) |

### Windows

**Install libraries via vcpkg (one-time setup):**

```powershell
git clone https://github.com/microsoft/vcpkg.git <YOUR_VCPKG_PATH>
<YOUR_VCPKG_PATH>\bootstrap-vcpkg.bat
<YOUR_VCPKG_PATH>\vcpkg install libwebp:x64-windows-static libpng:x64-windows-static
```

**Set environment variables (permanent):**

1. Win + R → `sysdm.cpl` → Advanced → Environment Variables
2. Under "User variables", add:
   - `LIBWEBP_ROOT` = `<YOUR_VCPKG_PATH>\installed\x64-windows-static`
   - `LIBPNG_ROOT` = `<YOUR_VCPKG_PATH>\installed\x64-windows-static`
3. Restart your terminal after saving

> `set VAR=...` in cmd is session-only and will not persist.

**Build the addons:**

```powershell
bun run prebuild:native
```

### macOS

**Install libraries via Homebrew (one-time setup):**

```bash
brew install webp libpng
```

**Build the addons (LIBWEBP_ROOT and LIBPNG_ROOT are auto-detected from brew):**

```bash
bun run prebuild:native
```

The script outputs built binaries to:

```
src/native/prebuilds/
  win32-x64/
    webp-alpha.node
    konomi-image.node
  darwin-x64/
    webp-alpha.node
    konomi-image.node
  darwin-arm64/
    webp-alpha.node
    konomi-image.node
```

Commit the generated `.node` files when updating native addons.

---

## 3. Database Setup

```bash
bun run db:generate   # Generate Prisma client
bun run db:migrate    # Run migrations (app must be closed)
```

---

## 4. Run in Development

```bash
bun run dev
```

This starts Electron + Vite with HMR.

---

## 5. Build for Distribution

```bash
bun run build:win    # Windows installer
bun run build:mac    # macOS app
bun run build:linux  # Linux AppImage / deb
```

> **Note:** Run `bun run db:migrate` before building if the schema has changed.

---

## Project Structure

```
src/core/              Platform-agnostic business logic
src/app/               Electron desktop app (main, preload, renderer)
src/web/               Shared React UI + web client
src/server/            Fastify web backend
src/native/            C++ native addons + prebuilt binaries
prisma/                Prisma schema + migrations
scripts/               Build and utility scripts
```

## Key Commands

```bash
bun run dev              # Start dev server
bun run build            # Typecheck + build
bun run typecheck        # Run typechecks
bun run lint             # ESLint
bun run prebuild:native  # Rebuild native addons
bun run db:migrate       # Run Prisma migrations
bun run db:generate      # Regenerate Prisma client
```
