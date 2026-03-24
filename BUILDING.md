# Building the Konomi

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| [Node.js](https://nodejs.org/) | 22+ | |
| [Bun](https://bun.sh/) | latest | Package manager & script runner |
| [Git](https://git-scm.com/) | any | |
| **Windows** — [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) | 2019+ | C++ workload required for native addon |
| **Windows** — [vcpkg](https://vcpkg.io/) | any | For libwebp static library |
| **macOS** — [Homebrew](https://brew.sh/) | any | For libwebp |

---

## 1. Clone & Install

```bash
git clone https://github.com/blackwaterbread/Konomi.git
cd Konomi
bun install
```

---

## 2. Build the Native Addon (WebP support)

Konomi uses a custom C++ native addon (`webp-alpha`) to decode WebP images.
Prebuilt binaries are committed to the repository under `prebuilds/`, so this
step is only needed when building from source for the first time, or after
modifying `src/native/webp-alpha/`.

### Windows

**Install libwebp via vcpkg (one-time setup):**

```powershell
git clone https://github.com/microsoft/vcpkg.git <YOUR_VCPKG_PATH>
<YOUR_VCPKG_PATH>\bootstrap-vcpkg.bat
<YOUR_VCPKG_PATH>\vcpkg install libwebp:x64-windows-static
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

**Install libwebp via Homebrew (one-time setup):**

```bash
brew install webp
```

**Build the addon (LIBWEBP_ROOT is auto-detected from brew):**

```bash
bun run prebuild:native
```

The script outputs the built binary to:

```
prebuilds/
  win32-x64/webp-alpha.node
  darwin-x64/webp-alpha.node
  darwin-arm64/webp-alpha.node
```

Commit the generated `.node` file when updating the native addon.

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
src/native/webp-alpha/     C++ native addon source (libwebp binding)
prebuilds/             Prebuilt .node binaries (committed to git)
prisma/                Prisma schema + migrations
resources/             Bundled assets (prompts.db, icons)
scripts/               Build and utility scripts
src/
  main/                Electron main process
  main/lib/            Core logic (DB, scanning, metadata parsing)
  main/utility.ts      Utility process entry (DB/scanning worker)
  preload/             contextBridge IPC bridge
  renderer/src/        React UI
```

## Key Commands

```bash
bun run dev              # Start dev server
bun run build            # Typecheck + build
bun run typecheck        # Run typechecks
bun run lint             # ESLint
bun run prebuild:native  # Rebuild native WebP addon
bun run db:migrate       # Run Prisma migrations
bun run db:generate      # Regenerate Prisma client
```
